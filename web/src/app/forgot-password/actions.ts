"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type ForgotState = { error: string | null; sent: boolean };

/**
 * Send a password-reset link.
 *
 * Always reports success, whatever happened. Saying "no account with that
 * address" turns the form into a way of testing which company addresses exist
 * here — and the person who genuinely mistyped theirs is no worse off, because
 * the mail simply does not arrive either way.
 *
 * Rate limiting is Supabase's, not ours: GoTrue caps recovery mails per address
 * and per hour, so a form that reports nothing cannot be used to flood someone.
 */
export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address.", sent: false };

  // Built from the request rather than an env var. The reset link has to come
  // back to the host the person is actually using, and APP_URL being wrong or
  // unset would send them to localhost — discoverable only by a user who
  // cannot get in and cannot say why.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const redirectTo = `${proto}://${host}/reset-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  // Logged, not shown. A misconfigured mailer is our problem to see and not
  // the sender's to diagnose at a login screen.
  if (error) console.error("[forgot-password]", error.message);

  return { error: null, sent: true };
}
