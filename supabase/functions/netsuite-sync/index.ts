// supabase/functions/netsuite-sync/index.ts
//
// Scheduled Edge Function: pulls sales orders from NetSuite via SuiteQL and
// upserts the NetSuite-owned columns on `public.orders`. It never touches
// anything a user entered by hand (ship_date, billing_status, build data,
// notes, ...) -- see supabase/migrations/0002_rls.sql for how that's
// enforced on the database side too.
//
// Auth: NetSuite's OAuth 2.0 Machine-to-Machine (client credentials) grant,
// which is a JWT (RFC 7523) signed with your integration's private key --
// NOT a plain client-secret exchange. Set up a "Client Credentials" OAuth2
// integration in NetSuite (Setup > Integration Management) and a matching
// role/token to get the values this function needs (see README section
// "NetSuite credentials" for the exact setup steps).
//
// Deploy: `supabase functions deploy netsuite-sync`
// Schedule: Supabase Dashboard > Edge Functions > netsuite-sync > Cron,
// e.g. `*/10 * * * *` for every 10 minutes.
//
// Required secrets (`supabase secrets set ...`):
//   NETSUITE_ACCOUNT_ID        e.g. "1234567" (no "-sb1" suffix needed; include it for sandboxes)
//   NETSUITE_CLIENT_ID         the integration record's consumer key
//   NETSUITE_CERTIFICATE_ID    the "Certificate ID" of the uploaded public key (used as JWT `kid`)
//   NETSUITE_PRIVATE_KEY       PEM private key matching that certificate, newlines as \n
//   SUPABASE_URL               auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY  auto-provided by Supabase
//
// Optional secrets:
//   NETSUITE_LAB_ITEMS   comma-separated NetSuite item names (Item Name/Number)
//     whose line quantities count toward labs_qty. A trailing * matches any
//     item starting with that text. Matching ignores upper/lower case.
//     Default: "AMSL-ILC-*,legacy-AMSL-ILC-*,AMSL-ELEM,AMSL-STEM,AMSL-FAB-*"
//   NETSUITE_TS_ITEMS    same format, for teacher stations (ts_qty).
//     Default: "A+ Mobile Teachers Station*"
//   NETSUITE_SYNC_LOOKBACK_MINUTES  default "20" -- each run re-pulls sales
//     orders modified in this window (overlapping the 10-minute schedule so
//     nothing is missed). Set it very high (e.g. 5256000 = 10 years) for a
//     one-time backfill of every sales order, then set it back.
//   NETSUITE_PRODUCTION_YEAR  forces production_year on newly inserted
//     orders; otherwise the year of the NetSuite order date is used.
//
// Field mapping (confirmed against the live account):
//   doe_po    <- the standard "PO #" field (transaction.otherrefnum)
//   labs_qty  <- sum of line quantities for NETSUITE_LAB_ITEMS
//   ts_qty    <- sum of line quantities for NETSUITE_TS_ITEMS

import { createClient } from "npm:@supabase/supabase-js@2";

const REQUIRED_ENV = [
  "NETSUITE_ACCOUNT_ID",
  "NETSUITE_CLIENT_ID",
  "NETSUITE_CERTIFICATE_ID",
  "NETSUITE_PRIVATE_KEY",
] as const;

interface NetSuiteSalesOrderRow {
  so_internal_id: number;
  so_number: string;
  order_date: string | null;
  school: string;
  revenue: number | null;
  labs_qty: number;
  ts_qty: number;
  doe_po: string | null;
}

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((k) => !Deno.env.get(k));
}

// ---------------------------------------------------------------------------
// NetSuite OAuth2 M2M token exchange (JWT bearer assertion, RFC 7523)
// ---------------------------------------------------------------------------

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signAssertion(accountId: string, clientId: string, certificateId: string, privateKeyPem: string): Promise<string> {
  // Token endpoint lives under .app.netsuite.com, NOT .suitetalk.api.netsuite.com
  // (that second host is for actual data requests -- SuiteQL, record CRUD --
  // per NetSuite's own "Using Postman with OAuth 2.0" tutorial, which shows
  // this as the Access Token URL). Sending the token request to the data
  // host instead of the auth host is what was producing the generic
  // "unsupported_grant_type" rejection regardless of which grant_type value
  // was sent -- that host simply doesn't handle token requests the same way.
  const tokenUrl = `https://${accountId.toLowerCase().replace(/_/g, "-")}.app.netsuite.com/services/rest/auth/oauth2/v1/token`;

  const header = { alg: "PS256", typ: "JWT", kid: certificateId };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    sub: clientId,
    scope: "rest_webservices",
    aud: tokenUrl,
    exp: now + 3600,
    iat: now,
    jti: crypto.randomUUID(),
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(signature)}`;
}

async function getAccessToken(): Promise<{ accessToken: string; accountId: string }> {
  const accountId = Deno.env.get("NETSUITE_ACCOUNT_ID")!;
  const clientId = Deno.env.get("NETSUITE_CLIENT_ID")!;
  const certificateId = Deno.env.get("NETSUITE_CERTIFICATE_ID")!;
  const privateKey = Deno.env.get("NETSUITE_PRIVATE_KEY")!.replace(/\\n/g, "\n");

  const tokenUrl = `https://${accountId.toLowerCase().replace(/_/g, "-")}.app.netsuite.com/services/rest/auth/oauth2/v1/token`;
  const assertion = await signAssertion(accountId, clientId, certificateId, privateKey);

  // NetSuite's M2M flow: grant_type=client_credentials with the signed JWT
  // passed as a client assertion (RFC 7523 section 2.2). The other variant
  // (grant_type=jwt-bearer + assertion) is rejected with
  // "unsupported_grant_type" -- verified against the live account.
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });

  if (!resp.ok) {
    throw new Error(`NetSuite token request failed: ${resp.status} ${await resp.text()}`);
  }

  const json = await resp.json();
  return { accessToken: json.access_token as string, accountId };
}

// ---------------------------------------------------------------------------
// SuiteQL query
// ---------------------------------------------------------------------------

const DEFAULT_LAB_ITEMS = "AMSL-ILC-*,legacy-AMSL-ILC-*,AMSL-ELEM,AMSL-STEM,AMSL-FAB-*";
const DEFAULT_TS_ITEMS = "A+ Mobile Teachers Station*";

function itemPatterns(envName: string, fallback: string): string[] {
  return (Deno.env.get(envName) ?? fallback)
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

export function itemMatches(itemName: string, patterns: string[]): boolean {
  const name = itemName.trim().toLowerCase();
  return patterns.some((p) => p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : name === p);
}

// Runs one SuiteQL query and returns every row across all pages. NetSuite
// requires the query to be POSTed again for each page (its "next" links are
// not plain GETs), so page with limit/offset and resend the body each time.
async function runSuiteQL(accessToken: string, accountId: string, query: string): Promise<Record<string, unknown>[]> {
  const base = `https://${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const resp: Response = await fetch(`${base}?limit=${pageSize}&offset=${offset}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify({ q: query }),
    });

    if (!resp.ok) {
      throw new Error(`SuiteQL query failed: ${resp.status} ${await resp.text()}`);
    }

    const json = await resp.json();
    rows.push(...(json.items ?? []));
    if (!json.hasMore) break;
    offset += pageSize;
  }

  return rows;
}

async function fetchChangedSalesOrders(accessToken: string, accountId: string, lookbackMinutes: number): Promise<NetSuiteSalesOrderRow[]> {
  // The lookback is computed by NetSuite itself (SYSDATE) so it's always in
  // the account's own time zone. Comparing lastmodifieddate against a UTC
  // timestamp built here would be off by the account's UTC offset (8 hours
  // for this Pacific-time account), which silently matched nothing.
  const headerQuery = `
    SELECT
      t.id                                AS so_internal_id,
      t.tranid                            AS so_number,
      TO_CHAR(t.trandate, 'YYYY-MM-DD')   AS order_date,
      BUILTIN.DF(t.entity)                AS school,
      t.foreigntotal                      AS revenue,
      t.otherrefnum                       AS doe_po
    FROM transaction t
    WHERE t.type = 'SalesOrd'
      AND t.lastmodifieddate >= SYSDATE - (${lookbackMinutes} / 1440)
    ORDER BY t.id
  `;

  const headers = await runSuiteQL(accessToken, accountId, headerQuery);
  if (headers.length === 0) return [];

  // Labs and teacher stations aren't header fields in this account -- they
  // are line items. Pull per-order, per-item quantities for the changed
  // orders (in chunks, to keep the IN list a sane size) and total them up.
  const labPatterns = itemPatterns("NETSUITE_LAB_ITEMS", DEFAULT_LAB_ITEMS);
  const tsPatterns = itemPatterns("NETSUITE_TS_ITEMS", DEFAULT_TS_ITEMS);
  const totals = new Map<number, { labs: number; ts: number }>();

  const ids = headers.map((h) => Number(h.so_internal_id));
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const lineQuery = `
      SELECT
        tl.transaction       AS so_internal_id,
        i.itemid             AS item,
        SUM(-tl.quantity)    AS qty
      FROM transactionline tl
      JOIN item i ON i.id = tl.item
      WHERE tl.transaction IN (${chunk.join(",")})
        AND tl.mainline = 'F'
      GROUP BY tl.transaction, i.itemid
    `;

    for (const line of await runSuiteQL(accessToken, accountId, lineQuery)) {
      const soId = Number(line.so_internal_id);
      const qty = Number(line.qty ?? 0) || 0;
      const item = String(line.item ?? "");
      const t = totals.get(soId) ?? { labs: 0, ts: 0 };
      if (itemMatches(item, labPatterns)) t.labs += qty;
      if (itemMatches(item, tsPatterns)) t.ts += qty;
      totals.set(soId, t);
    }
  }

  return headers.map((h) => {
    const soId = Number(h.so_internal_id);
    const t = totals.get(soId) ?? { labs: 0, ts: 0 };
    return {
      so_internal_id: soId,
      so_number: String(h.so_number),
      order_date: (h.order_date as string | undefined) ?? null,
      school: (h.school as string | undefined) ?? "",
      revenue: h.revenue != null ? Number(h.revenue) : null,
      labs_qty: t.labs,
      ts_qty: t.ts,
      doe_po: (h.doe_po as string | undefined) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Upsert into Supabase
// ---------------------------------------------------------------------------

function productionYearFor(orderDate: string | null): number {
  // The sheet's "which year tab does this belong to" judgment call. Default
  // to the year of the NetSuite order date (so a backfill of older orders
  // lands in the right year); NETSUITE_PRODUCTION_YEAR forces a value if the
  // team is mid-transition between school years.
  const override = Deno.env.get("NETSUITE_PRODUCTION_YEAR");
  if (override) return Number(override);
  const year = orderDate ? Number(orderDate.slice(0, 4)) : NaN;
  return Number.isFinite(year) && year > 2000 ? year : new Date().getFullYear();
}

async function upsertOrders(rows: NetSuiteSalesOrderRow[]): Promise<{ upserted: number; reconciled: number; inserted: number }> {
  if (rows.length === 0) return { upserted: 0, reconciled: 0, inserted: 0 };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load what's already in the table once (id, so_number, netsuite_so_id
  // only), instead of two or three lookups per sales order. A full backfill
  // of every NetSuite order then takes one bulk insert plus one update per
  // already-known order, which keeps it well inside the function time limit.
  const byNetsuiteId = new Map<number, number>();
  const unlinkedBySoNumber = new Map<string, number[]>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, so_number, netsuite_so_id")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Supabase read of existing orders failed: ${error.message}`);
    for (const o of data ?? []) {
      if (o.netsuite_so_id != null) {
        byNetsuiteId.set(Number(o.netsuite_so_id), o.id);
      } else if (o.so_number) {
        const key = String(o.so_number).replace(/^SO/i, "").toUpperCase();
        const list = unlinkedBySoNumber.get(key) ?? [];
        list.push(o.id);
        unlinkedBySoNumber.set(key, list);
      }
    }
    if (!data || data.length < pageSize) break;
  }

  let updatedByNetsuiteId = 0;
  let reconciledBySoNumber = 0;
  const toInsert: Record<string, unknown>[] = [];

  // Three paths per NetSuite sales order:
  //   1. Already linked by netsuite_so_id -> update that row.
  //   2. Not linked, but a historically-imported row has the same SO number
  //      -> link the oldest such row (by id). The spreadsheet stored bare
  //      numbers ("144592") and NetSuite uses "SO144592", so both forms
  //      match. so_number is not unique (a few orders were split across
  //      several tracked rows); only one row can carry the netsuite_so_id,
  //      so sibling rows stay historical-only.
  //   3. Otherwise it's new -> insert (in bulk, below).
  for (const r of rows) {
    const netsuiteFields = {
      netsuite_so_id: r.so_internal_id,
      so_number: r.so_number,
      order_date: r.order_date,
      school: r.school,
      revenue: r.revenue,
      labs_qty: r.labs_qty,
      ts_qty: r.ts_qty,
      doe_po: r.doe_po,
    };

    let targetId = byNetsuiteId.get(r.so_internal_id);
    let reconciling = false;
    if (targetId === undefined) {
      const key = r.so_number.replace(/^SO/i, "").toUpperCase();
      const candidates = unlinkedBySoNumber.get(key);
      if (candidates && candidates.length > 0) {
        targetId = candidates.shift()!;
        reconciling = true;
      }
    }

    if (targetId === undefined) {
      toInsert.push({ ...netsuiteFields, production_year: productionYearFor(r.order_date) });
      continue;
    }

    const { error } = await supabase.from("orders").update(netsuiteFields).eq("id", targetId);
    if (error) throw new Error(`Supabase update failed for SO ${r.so_number}: ${error.message}`);
    byNetsuiteId.set(r.so_internal_id, targetId);
    if (reconciling) reconciledBySoNumber += 1;
    else updatedByNetsuiteId += 1;
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase.from("orders").insert(toInsert.slice(i, i + 500));
    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return {
    upserted: updatedByNetsuiteId + reconciledBySoNumber + toInsert.length,
    reconciled: reconciledBySoNumber,
    inserted: toInsert.length,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (_req) => {
  const missing = missingEnv();
  if (missing.length > 0) {
    // Lets the function be deployed and scheduled before real NetSuite
    // credentials exist, instead of failing the whole deploy.
    const message = `netsuite-sync: not configured yet, skipping (missing: ${missing.join(", ")})`;
    console.log(message);
    return new Response(JSON.stringify({ skipped: true, reason: message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const lookbackMinutes = Math.floor(Number(Deno.env.get("NETSUITE_SYNC_LOOKBACK_MINUTES") ?? "20"));
    if (!Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) {
      throw new Error("NETSUITE_SYNC_LOOKBACK_MINUTES must be a positive number of minutes");
    }

    const { accessToken, accountId } = await getAccessToken();
    const rows = await fetchChangedSalesOrders(accessToken, accountId, lookbackMinutes);
    const { upserted, reconciled, inserted } = await upsertOrders(rows);

    const result = { ok: true, fetched: rows.length, upserted, reconciled, inserted, lookback_minutes: lookbackMinutes };
    console.log("netsuite-sync:", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("netsuite-sync failed:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
