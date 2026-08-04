"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null };

function safeNext(next: FormDataEntryValue | null): string | null {
  const n = typeof next === "string" ? next : "";
  // Only allow same-origin relative paths (guard against open redirects).
  return n.startsWith("/") && !n.startsWith("//") ? n : null;
}

export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password)
    return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  // Phase 1: everyone lands on the /dashboard hub. Later phases route each
  // role to its dedicated screen via homeForRole().
  redirect(next ?? "/dashboard");
}

// Self-service sign-up is deliberately not implemented: accounts are created by
// an administrator. Note this only closes the app-level path — Supabase GoTrue
// still accepts POST /auth/v1/signup with the publishable key, so sign-ups must
// also be turned off in the Supabase dashboard (Authentication → Sign In /
// Providers → Email → "Allow new users to sign up").

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
