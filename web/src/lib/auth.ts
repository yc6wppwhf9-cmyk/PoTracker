import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/database.types";

export type SessionProfile = {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: AppRole;
};

/**
 * Returns the current user's profile (id + role), or null if not signed in.
 * Uses getUser() (validates the JWT with Supabase) — never trust getSession()
 * alone for authorization.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    userId: user.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
  };
}

/** Require a signed-in user; redirect to /login otherwise. */
export async function requireUser(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

/**
 * Require the signed-in user to hold one of the given roles (admin always
 * passes). Redirects to /login if unauthenticated, or /dashboard if the role
 * is insufficient.
 */
export async function requireRole(
  ...roles: AppRole[]
): Promise<SessionProfile> {
  const profile = await requireUser();
  if (profile.role !== "admin" && !roles.includes(profile.role)) {
    redirect("/dashboard");
  }
  return profile;
}
