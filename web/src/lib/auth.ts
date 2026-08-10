import { cache } from "react";
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
 *
 * Wrapped in React's `cache`, so it runs ONCE per request no matter how many
 * times it is called during that render. A page calls requireRole(), then
 * AppShell needs the same profile, and sometimes a child does too — each of
 * those was a separate getUser() (a network call to Supabase Auth) plus a
 * separate profiles query. From a function in Tokyo that is cheap; from one in
 * Washington it was most of a second, spent re-answering a question already
 * answered. The cache is per-request, so it cannot serve one user's profile to
 * another.
 */
export const getSessionProfile = cache(async function getSessionProfile(): Promise<SessionProfile | null> {
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
});

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
