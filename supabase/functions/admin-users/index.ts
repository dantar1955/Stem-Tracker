// supabase/functions/admin-users/index.ts
//
// Admin-only user management for the Admin tab:
//   list             every user with role, status and last sign-in
//   create           new user with a temporary password (must change it at first sign-in)
//   update           name, email and/or role
//   reset_password   set a new temporary password (must change it at next sign-in)
//   suspend          block sign-in and all changes; unsuspend reverses it
// Every action is written to the audit trail. Passwords are never logged.
//
// Deploy: `npx supabase functions deploy admin-users`

import { audit, corsHeaders, HttpError, json, requireAdmin, type AdminContext } from "../_shared/admin.ts";

const ROLES = ["admin", "sales", "operations", "accounting"] as const;
type AppRole = (typeof ROLES)[number];

// Long enough to survive a forced sign-out; "none" lifts it.
const SUSPEND_DURATION = "876000h";

interface Body {
  action?: string;
  user_id?: string;
  email?: string;
  full_name?: string;
  role?: string;
  temp_password?: string;
}

function requireUserId(id: string | undefined): string {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, "A valid user_id is required");
  }
  return id;
}

function requireRole(role: string | undefined): AppRole {
  if (!role || !ROLES.includes(role as AppRole)) {
    throw new HttpError(400, `Role must be one of: ${ROLES.join(", ")}`);
  }
  return role as AppRole;
}

function requirePassword(pw: string | undefined): string {
  if (!pw || pw.length < 8) throw new HttpError(400, "Temporary password must be at least 8 characters");
  return pw;
}

function requireEmail(email: string | undefined): string {
  const e = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Enter a valid email address");
  return e;
}

async function roleRow(ctx: AdminContext, userId: string) {
  const { data, error } = await ctx.admin
    .from("user_roles")
    .select("role, full_name, suspended")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data;
}

// Refuse anything that would leave the system with no active admin.
async function ensureAnotherActiveAdmin(ctx: AdminContext, userId: string) {
  const { count, error } = await ctx.admin
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("suspended", false)
    .neq("user_id", userId);
  if (error) throw new HttpError(500, error.message);
  if (!count) throw new HttpError(400, "This is the only active admin. Make someone else an admin first.");
}

async function getAuthUser(ctx: AdminContext, userId: string) {
  const { data, error } = await ctx.admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new HttpError(404, "User not found");
  return data.user;
}

async function listUsers(ctx: AdminContext) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await ctx.admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new HttpError(500, error.message);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }

  const { data: roles, error } = await ctx.admin.from("user_roles").select("user_id, role, full_name, suspended");
  if (error) throw new HttpError(500, error.message);
  const byId = new Map(roles.map((r) => [r.user_id, r]));

  return users
    .map((u) => {
      const r = byId.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: r?.full_name ?? (u.user_metadata?.full_name as string | undefined) ?? null,
        role: r?.role ?? null,
        suspended: r?.suspended ?? false,
        must_change_password: Boolean(u.user_metadata?.must_change_password),
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at,
      };
    })
    .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));
}

async function handle(ctx: AdminContext, body: Body) {
  switch (body.action) {
    case "list":
      return { users: await listUsers(ctx) };

    case "create": {
      const email = requireEmail(body.email);
      const role = requireRole(body.role);
      const password = requirePassword(body.temp_password);
      const fullName = (body.full_name ?? "").trim() || null;

      const { data, error } = await ctx.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, must_change_password: true },
      });
      if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create user");

      const { error: roleError } = await ctx.admin
        .from("user_roles")
        .insert({ user_id: data.user.id, role, full_name: fullName, suspended: false });
      if (roleError) {
        await ctx.admin.auth.admin.deleteUser(data.user.id); // don't leave a user with no role
        throw new HttpError(500, roleError.message);
      }

      await audit(ctx, "user_created", {
        table: "users",
        recordId: data.user.id,
        recordLabel: fullName ?? email,
        details: { email, role, full_name: fullName },
      });
      return { ok: true, user_id: data.user.id };
    }

    case "update": {
      body.user_id = requireUserId(body.user_id);
      const user = await getAuthUser(ctx, body.user_id);
      const before = await roleRow(ctx, body.user_id);
      const changes: Record<string, { old: unknown; new: unknown }> = {};

      const newEmail = body.email !== undefined ? requireEmail(body.email) : undefined;
      const newName = body.full_name !== undefined ? body.full_name.trim() || null : undefined;
      const newRole = body.role !== undefined ? requireRole(body.role) : undefined;

      if (newRole && before?.role === "admin" && newRole !== "admin") {
        await ensureAnotherActiveAdmin(ctx, body.user_id);
      }

      if ((newEmail && newEmail !== user.email) || (newName !== undefined && newName !== before?.full_name)) {
        const { error } = await ctx.admin.auth.admin.updateUserById(body.user_id, {
          ...(newEmail && newEmail !== user.email ? { email: newEmail, email_confirm: true } : {}),
          user_metadata: { ...user.user_metadata, ...(newName !== undefined ? { full_name: newName } : {}) },
        });
        if (error) throw new HttpError(400, error.message);
        if (newEmail && newEmail !== user.email) changes.email = { old: user.email, new: newEmail };
      }

      const rolePatch: Record<string, unknown> = {};
      if (newName !== undefined && newName !== before?.full_name) {
        rolePatch.full_name = newName;
        changes.full_name = { old: before?.full_name ?? null, new: newName };
      }
      if (newRole && newRole !== before?.role) {
        rolePatch.role = newRole;
        changes.role = { old: before?.role ?? null, new: newRole };
      }
      if (Object.keys(rolePatch).length > 0) {
        const { error } = before
          ? await ctx.admin.from("user_roles").update(rolePatch).eq("user_id", body.user_id)
          : await ctx.admin.from("user_roles").insert({ user_id: body.user_id, role: newRole ?? "operations", ...rolePatch });
        if (error) throw new HttpError(500, error.message);
      }

      if (Object.keys(changes).length > 0) {
        await audit(ctx, "user_updated", {
          table: "users",
          recordId: body.user_id,
          recordLabel: newName ?? before?.full_name ?? user.email,
          changes,
        });
      }
      return { ok: true };
    }

    case "reset_password": {
      body.user_id = requireUserId(body.user_id);
      const password = requirePassword(body.temp_password);
      const user = await getAuthUser(ctx, body.user_id);
      const { error } = await ctx.admin.auth.admin.updateUserById(body.user_id, {
        password,
        user_metadata: { ...user.user_metadata, must_change_password: true },
      });
      if (error) throw new HttpError(400, error.message);
      const r = await roleRow(ctx, body.user_id);
      await audit(ctx, "password_reset", {
        table: "users",
        recordId: body.user_id,
        recordLabel: r?.full_name ?? user.email,
        details: { email: user.email, note: "Temporary password set; user must change it at next sign-in" },
      });
      return { ok: true };
    }

    case "suspend":
    case "unsuspend": {
      body.user_id = requireUserId(body.user_id);
      const suspend = body.action === "suspend";
      if (suspend && body.user_id === ctx.caller.id) throw new HttpError(400, "You can't suspend yourself");
      const user = await getAuthUser(ctx, body.user_id);
      const r = await roleRow(ctx, body.user_id);
      if (suspend && r?.role === "admin") await ensureAnotherActiveAdmin(ctx, body.user_id);

      const { error } = await ctx.admin.auth.admin.updateUserById(body.user_id, {
        ban_duration: suspend ? SUSPEND_DURATION : "none",
      });
      if (error) throw new HttpError(400, error.message);
      if (r) {
        const { error: roleError } = await ctx.admin
          .from("user_roles")
          .update({ suspended: suspend })
          .eq("user_id", body.user_id);
        if (roleError) throw new HttpError(500, roleError.message);
      }

      await audit(ctx, suspend ? "user_suspended" : "user_unsuspended", {
        table: "users",
        recordId: body.user_id,
        recordLabel: r?.full_name ?? user.email,
        details: { email: user.email },
      });
      return { ok: true };
    }

    default:
      throw new HttpError(400, "Unknown action");
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(origin, { error: "Method not allowed" }, 405);

  try {
    const ctx = await requireAdmin(req);
    let body: Body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
    return json(origin, await handle(ctx, body));
  } catch (err) {
    if (err instanceof HttpError) return json(origin, { error: err.message }, err.status);
    console.error("admin-users failed:", err);
    return json(origin, { error: "Something went wrong" }, 500);
  }
});
