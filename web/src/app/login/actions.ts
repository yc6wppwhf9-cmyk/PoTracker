"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/env";

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

  // Checked before attempting the call: a missing or malformed project URL
  // surfaces from supabase-js as a bare "fetch failed", which names neither
  // the variable at fault nor the host it tried to reach.
  const url = supabaseUrl();
  if (!url || !/^https?:\/\//.test(url))
    return {
      error:
        "Sign-in is not configured: NEXT_PUBLIC_SUPABASE_URL is missing or " +
        `not a URL (${url || "empty"}). It must be the Supabase project URL, ` +
        "not the API URL.",
    };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // "fetch failed" means the host was unreachable, not that the credentials
    // were wrong — say which host, so the misconfiguration is visible.
    if (/fetch failed|network/i.test(error.message)) {
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return url;
        }
      })();
      return {
        error:
          `Could not reach the authentication server at ${host}. Check ` +
          "NEXT_PUBLIC_SUPABASE_URL points at your Supabase project.",
      };
    }
    return { error: error.message };
  }

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
