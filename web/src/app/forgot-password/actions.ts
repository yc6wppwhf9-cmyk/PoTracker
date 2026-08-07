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
  // Via /auth/callback, not straight to the form. The code exchange has to
  // happen somewhere cookies can be written, which a Server Component render
  // is not — see that route for what went wrong when it did.
  const redirectTo = `${proto}://${host}/auth/callback?next=/reset-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) console.error("[forgot-password]", error.message);

  // A rate limit IS shown, unlike every other failure here.
  //
  // Reporting success for an unknown address is deliberate — otherwise this
  // form tells a stranger which company addresses exist. A rate limit says
  // nothing about the address, only about how much mail the project has sent,
  // so hiding it protects nobody and leaves the person waiting for a message
  // that was never sent. That is exactly what happened: Supabase's built-in
  // sender allows a couple of messages an hour across the whole project, and
  // the third request returned over_email_send_rate_limit while this screen
  // said the link was on its way.
  const limited =
    error &&
    (/rate limit/i.test(error.message) ||
      (error as { code?: string }).code === "over_email_send_rate_limit" ||
      (error as { status?: number }).status === 429);

  if (limited)
    return {
      error:
        "Too many reset emails have been sent recently. Wait an hour and try " +
        "again, or ask an administrator to set your password directly.",
      sent: false,
    };

  return { error: null, sent: true };
}
