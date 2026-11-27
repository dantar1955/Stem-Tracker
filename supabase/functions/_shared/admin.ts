// supabase/functions/_shared/admin.ts
//
// Shared by the admin-only Edge Functions (admin-users, admin-backup):
// CORS, JSON responses, checking the caller is a signed-in, active admin,
// and writing audit-trail entries. These functions run with the service
// role key, which never reaches the browser.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AdminContext {
  admin: SupabaseClient;
  caller: User;
  callerName: string | null;
}

// Returns a service-role client plus the calling user, or throws an
// HttpError if the caller isn't a signed-in, non-suspended admin.
export async function requireAdmin(req: Request): Promise<AdminContext> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid session");

  const { data: roleRow, error: roleError } = await admin
    .from("user_roles")
    .select("role, full_name, suspended")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (roleError) throw new HttpError(500, roleError.message);
  if (roleRow?.role !== "admin" || roleRow?.suspended) throw new HttpError(403, "Admins only");

  return { admin, caller: data.user, callerName: roleRow.full_name ?? null };
}

export async function audit(
  ctx: AdminContext,
  action: string,
  entry: { table?: string; recordId?: string; recordLabel?: string; changes?: unknown; details?: unknown },
): Promise<void> {
  const { error } = await ctx.admin.from("audit_log").insert({
    actor_id: ctx.caller.id,
    actor_email: ctx.caller.email ?? null,
    actor_name: ctx.callerName,
    source: "app",
    action,
    table_name: entry.table ?? null,
    record_id: entry.recordId ?? null,
    record_label: entry.recordLabel ?? null,
    changes: entry.changes ?? null,
    details: entry.details ?? null,
  });
  // The action itself already happened; a failed log entry shouldn't undo
  // it, but it must not go unnoticed either.
  if (error) console.error(`audit(${action}) failed:`, error.message);
}
