"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ALL_ROLES } from "@/lib/roles";
import { cleanEnv } from "@/lib/env";
import type { AppRole } from "@/lib/database.types";

export type UpdateRoleState = { error: string | null; ok: boolean };

export async function updateRole(
  _prev: UpdateRoleState,
  formData: FormData
): Promise<UpdateRoleState> {
  // Server-side authorization: only admins may change roles. RLS enforces this
  // too (profiles_admin_all), but we fail fast and clearly here.
  const admin = await requireRole("admin");

  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;

  if (!userId) return { error: "Missing user.", ok: false };
  if (!ALL_ROLES.includes(role)) return { error: "Invalid role.", ok: false };

  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) return { error: error.message, ok: false };

  await supabase.from("audit_log").insert({
    actor_id: admin.userId,
    entity: "profiles",
    entity_id: userId,
    action: "role_changed",
    detail: { role },
  });

  revalidatePath("/admin/users");
  return { error: null, ok: true };
}


export type CreateUserState = { error: string | null; ok: boolean; email: string | null };

/**
 * Create a login.
 *
 * Delegated to the API rather than done here. Creating an auth user needs the
 * service-role key — GoTrue has no policy system, so there is no way to do it
 * as the signed-in admin — and that key must never reach the web app, whose
 * environment is one misconfiguration away from a client bundle. It lives on
 * the API service, behind an endpoint that checks the caller is an admin.
 *
 * The admin's own access token is forwarded, so the API authenticates the
 * person rather than trusting this call.
 */
export async function createUser(
  _prev: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  await requireRole("admin");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "uploader") as AppRole;

  if (!email) return { error: "Email is required.", ok: false, email: null };
  if (password.length < 8)
    return { error: "Use a password of at least 8 characters.", ok: false, email: null };
  if (!ALL_ROLES.includes(role))
    return { error: "Invalid role.", ok: false, email: null };

  const base =
    cleanEnv("API_BASE_URL", process.env.API_BASE_URL) ||
    cleanEnv("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL);
  if (!base)
    return {
      error:
        "API_BASE_URL is not set on the web app, so it does not know where " +
        "the service that creates accounts is.",
      ok: false,
      email: null,
    };

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token)
    return { error: "Your session has expired — sign in again.", ok: false, email: null };

  let res: Response;
  try {
    res = await fetch(`${base}/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, full_name: fullName, role }),
    });
  } catch (e) {
    return {
      error: `Could not reach the account service at ${base} (${
        e instanceof Error ? e.message : "failed"
      }).`,
      ok: false,
      email: null,
    };
  }

  const raw = await res.text();
  if (!res.ok) {
    // The API's own message is far more specific than anything inferable
    // here — it distinguishes a duplicate address from a missing key.
    let detail = raw.slice(0, 300);
    try {
      detail = (JSON.parse(raw) as { detail?: string }).detail ?? detail;
    } catch {}
    return { error: detail, ok: false, email: null };
  }

  revalidatePath("/admin/users");
  return { error: null, ok: true, email };
}


export type UserActionState = { error: string | null; ok: boolean; message: string | null };

/**
 * Disable, re-enable, or delete an account.
 *
 * All three go through the API for the same reason creation does: they need
 * the service-role key, which must never reach the web app.
 */
async function callAdmin(
  path: string,
  method: "POST" | "DELETE"
): Promise<UserActionState> {
  await requireRole("admin");

  const base =
    cleanEnv("API_BASE_URL", process.env.API_BASE_URL) ||
    cleanEnv("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL);
  if (!base)
    return { error: "API_BASE_URL is not set on the web app.", ok: false, message: null };

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token)
    return { error: "Your session has expired — sign in again.", ok: false, message: null };

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch (e) {
    return {
      error: `Could not reach the account service (${
        e instanceof Error ? e.message : "failed"
      }).`,
      ok: false,
      message: null,
    };
  }

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 400);
    try {
      detail = (JSON.parse(raw) as { detail?: string }).detail ?? detail;
    } catch {}
    return { error: detail, ok: false, message: null };
  }

  revalidatePath("/admin/users");
  return { error: null, ok: true, message: null };
}

// Declared as async functions, not arrow consts. Every export of a "use
// server" module has to be an async function for Next to treat it as an
// action; a const assigned a non-async expression is silently not one, and the
// failure appears at build time as "export was not found".
export async function disableUser(id: string): Promise<UserActionState> {
  return callAdmin(`/admin/users/${id}/disable`, "POST");
}

export async function enableUser(id: string): Promise<UserActionState> {
  return callAdmin(`/admin/users/${id}/enable`, "POST");
}

export async function deleteUser(id: string): Promise<UserActionState> {
  return callAdmin(`/admin/users/${id}`, "DELETE");
}
