// supabase/functions/admin-backup/index.ts
//
// Admin-only: returns a complete copy of the system's data as JSON -- every
// app table, plus the user list (email, name, role, status; never
// passwords). The Admin tab turns it into a downloadable Excel workbook
// and a JSON file. Each backup is recorded in the audit trail.
//
// Deploy: `npx supabase functions deploy admin-backup`

import { audit, corsHeaders, HttpError, json, requireAdmin } from "../_shared/admin.ts";

const TABLES = [
  "orders",
  "builds",
  "shortages",
  "device_shipments",
  "pipeline_entries",
  "year_goals",
  "weekly_snapshots",
  "simulation_scenarios",
  "simulation_items",
  "user_roles",
  "audit_log",
] as const;

const PAGE = 1000;

// Column to page through each table in a stable order.
const ORDER_BY: Record<string, string> = { user_roles: "user_id", year_goals: "production_year" };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(origin, { error: "Method not allowed" }, 405);

  try {
    const ctx = await requireAdmin(req);
    const tables: Record<string, unknown[]> = {};

    for (const table of TABLES) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await ctx.admin
          .from(table)
          .select("*")
          .order(ORDER_BY[table] ?? "id")
          .range(from, from + PAGE - 1);
        if (error) throw new HttpError(500, `${table}: ${error.message}`);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      tables[table] = rows;
    }

    const users = [];
    for (let page = 1; ; page++) {
      const { data, error } = await ctx.admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, error.message);
      users.push(
        ...data.users.map((u) => ({
          id: u.id,
          email: u.email,
          full_name: u.user_metadata?.full_name ?? null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          banned_until: (u as { banned_until?: string }).banned_until ?? null,
        })),
      );
      if (data.users.length < 200) break;
    }
    tables.users = users;

    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
    const generatedAt = new Date().toISOString();

    await audit(ctx, "backup_created", { details: { generated_at: generatedAt, counts } });

    return json(origin, {
      format: "stem-tracker-backup",
      version: 1,
      generated_at: generatedAt,
      generated_by: ctx.caller.email,
      counts,
      tables,
    });
  } catch (err) {
    if (err instanceof HttpError) return json(origin, { error: err.message }, err.status);
    console.error("admin-backup failed:", err);
    return json(origin, { error: "Something went wrong" }, 500);
  }
});
