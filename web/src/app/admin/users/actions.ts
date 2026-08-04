"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ALL_ROLES } from "@/lib/roles";
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
