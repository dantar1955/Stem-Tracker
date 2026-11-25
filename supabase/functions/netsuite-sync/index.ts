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
// Optional secrets (override if your NetSuite instance uses different
// custom field IDs for these -- confirm the real ones with your NetSuite
// admin before going live; these are placeholders):
//   NETSUITE_FIELD_LABS_QTY    default "custbody_labs_qty"
//   NETSUITE_FIELD_TS_QTY      default "custbody_ts_qty"
//   NETSUITE_FIELD_DOE_PO      default "custbody_doe_po"
//   NETSUITE_SYNC_LOOKBACK_MINUTES  default "20" -- re-checks a small
//     overlap window every run so a clock-skewed edit is never missed.

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
  const tokenUrl = `https://${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

  const header = { alg: "PS256", typ: "JWT", kid: certificateId };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    scope: "rest_webservices",
    aud: tokenUrl,
    exp: now + 3600,
    iat: now,
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

  const tokenUrl = `https://${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  const assertion = await signAssertion(accountId, clientId, certificateId, privateKey);

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
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

async function fetchChangedSalesOrders(accessToken: string, accountId: string, sinceIso: string): Promise<NetSuiteSalesOrderRow[]> {
  const labsField = Deno.env.get("NETSUITE_FIELD_LABS_QTY") ?? "custbody_labs_qty";
  const tsField = Deno.env.get("NETSUITE_FIELD_TS_QTY") ?? "custbody_ts_qty";
  const doeField = Deno.env.get("NETSUITE_FIELD_DOE_PO") ?? "custbody_doe_po";

  // One row per sales order header. Adjust the custom field names above (via
  // env vars) to match this NetSuite account's actual customizations --
  // these are placeholders until confirmed.
  const query = `
    SELECT
      t.id                AS so_internal_id,
      t.tranid            AS so_number,
      t.trandate           AS order_date,
      BUILTIN.DF(t.entity) AS school,
      t.foreigntotal       AS revenue,
      t.${labsField}       AS labs_qty,
      t.${tsField}         AS ts_qty,
      t.${doeField}        AS doe_po
    FROM transaction t
    WHERE t.type = 'SalesOrd'
      AND t.lastmodifieddate >= TO_DATE('${sinceIso}', 'YYYY-MM-DD"T"HH24:MI:SS')
    ORDER BY t.lastmodifieddate ASC
  `;

  const url = `https://${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

  const rows: NetSuiteSalesOrderRow[] = [];
  let nextUrl: string | null = url;
  let body: unknown = { q: query };

  while (nextUrl) {
    const resp: Response = await fetch(nextUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`SuiteQL query failed: ${resp.status} ${await resp.text()}`);
    }

    const json = await resp.json();
    for (const item of json.items ?? []) {
      rows.push({
        so_internal_id: Number(item.so_internal_id),
        so_number: String(item.so_number),
        order_date: item.order_date ?? null,
        school: item.school ?? "",
        revenue: item.revenue != null ? Number(item.revenue) : null,
        labs_qty: item.labs_qty != null ? Number(item.labs_qty) : 0,
        ts_qty: item.ts_qty != null ? Number(item.ts_qty) : 0,
        doe_po: item.doe_po ?? null,
      });
    }

    // SuiteQL paginates via `links` with a "next" rel; follow it with a GET
    // (no body needed on subsequent pages).
    const next = (json.links ?? []).find((l: { rel: string; href: string }) => l.rel === "next");
    nextUrl = next ? next.href : null;
    body = undefined;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Upsert into Supabase
// ---------------------------------------------------------------------------

function currentProductionYear(): number {
  // The sheet's "which year tab does this belong to" judgment call. Default
  // to the calendar year; override by setting NETSUITE_PRODUCTION_YEAR if
  // the team is mid-transition between school years at sync time.
  const override = Deno.env.get("NETSUITE_PRODUCTION_YEAR");
  return override ? Number(override) : new Date().getFullYear();
}

async function upsertOrders(rows: NetSuiteSalesOrderRow[]): Promise<{ upserted: number; reconciled: number; inserted: number }> {
  if (rows.length === 0) return { upserted: 0, reconciled: 0, inserted: 0 };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let updatedByNetsuiteId = 0;
  let reconciledBySoNumber = 0;
  let inserted = 0;

  // Three paths, tried in order, per row:
  //   1. A row already linked to this NetSuite id -> plain update. Safe as a
  //      bulk update: netsuite_so_id is UNIQUE, so at most one row can ever
  //      match.
  //   2. A row with the same so_number but no netsuite_so_id yet -> this is
  //      a historically-imported order NetSuite hasn't been matched to yet;
  //      link it instead of inserting a duplicate. so_number is NOT unique
  //      (a handful of real sales orders are split across more than one
  //      tracked row for separate device shipments), so more than one row
  //      can match here. netsuite_so_id IS still unique, so blindly running
  //      one UPDATE across every match would try to set the same
  //      netsuite_so_id on multiple rows and fail the unique constraint.
  //      Select the oldest unreconciled match and update it by id instead --
  //      any sibling rows stay historical-only (there is only one real
  //      NetSuite transaction per SO to link to, not one per tracked row).
  //   3. Otherwise this is a sales order the app has never seen -> insert.
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

    const { count: matchedById, error: updateByIdError } = await supabase
      .from("orders")
      .update(netsuiteFields, { count: "exact" })
      .eq("netsuite_so_id", r.so_internal_id);

    if (updateByIdError) throw new Error(`Supabase update-by-id failed for SO ${r.so_number}: ${updateByIdError.message}`);

    if (matchedById && matchedById > 0) {
      updatedByNetsuiteId += matchedById;
      continue;
    }

    const { data: candidates, error: findError } = await supabase
      .from("orders")
      .select("id")
      .eq("so_number", r.so_number)
      .is("netsuite_so_id", null)
      .order("id", { ascending: true })
      .limit(1);

    if (findError) throw new Error(`Supabase lookup failed for SO ${r.so_number}: ${findError.message}`);

    if (candidates && candidates.length > 0) {
      const { error: reconcileError } = await supabase
        .from("orders")
        .update(netsuiteFields)
        .eq("id", candidates[0].id);

      if (reconcileError) throw new Error(`Supabase reconcile-by-so_number failed for SO ${r.so_number}: ${reconcileError.message}`);

      reconciledBySoNumber += 1;
      continue;
    }

    const { error: insertError } = await supabase
      .from("orders")
      .insert({ ...netsuiteFields, production_year: currentProductionYear() });

    if (insertError) throw new Error(`Supabase insert failed for SO ${r.so_number}: ${insertError.message}`);
    inserted += 1;
  }

  return {
    upserted: updatedByNetsuiteId + reconciledBySoNumber + inserted,
    reconciled: reconciledBySoNumber,
    inserted,
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
    const lookbackMinutes = Number(Deno.env.get("NETSUITE_SYNC_LOOKBACK_MINUTES") ?? "20");
    const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString().slice(0, 19);

    const { accessToken, accountId } = await getAccessToken();
    const rows = await fetchChangedSalesOrders(accessToken, accountId, sinceIso);
    const { upserted, reconciled, inserted } = await upsertOrders(rows);

    const result = { ok: true, fetched: rows.length, upserted, reconciled, inserted, since: sinceIso };
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
