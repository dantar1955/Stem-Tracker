// supabase/functions/invite-user/index.ts
//
// Admin-only: invites a new user by email and assigns them an app role.
// The frontend never holds the service-role key (it must never ship to the
// browser), so creating auth users and writing user_roles for someone else
// both have to happen server-side -- this function is that server side.
//
// Deploy: `supabase functions deploy invite-user`
// Called from: AdminUsersPage.tsx, via supabase.functions.invoke('invite-user', ...)

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ROLES = ["admin", "sales", "operations", "accounting"] as const;
type AppRole = (typeof ALLOWED_ROLES)[number];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // Service-role client: used for both verifying the caller and performing
  // the privileged admin actions below.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { data: callerRole } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  if (callerRole?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Only admins can invite users" }), {
      status: 403,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  let body: { email?: string; role?: string; full_name?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { email, role, full_name } = body;

  if (!email || !role || !ALLOWED_ROLES.includes(role as AppRole)) {
    return new Response(
      JSON.stringify({ error: `email and a valid role (${ALLOWED_ROLES.join(", ")}) are required` }),
      { status: 400, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited.user) {
    return new Response(JSON.stringify({ error: inviteError?.message ?? "Invite failed" }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { error: roleError } = await admin
    .from("user_roles")
    .upsert({ user_id: invited.user.id, role, full_name: full_name ?? null });

  if (roleError) {
    return new Response(JSON.stringify({ error: `Invited, but failed to set role: ${roleError.message}` }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, user_id: invited.user.id }), {
    status: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
});
