"use server";

import { headers } from "next/headers";
import { supabaseUrl, supabaseAnonKey } from "@/lib/env";

export type ForgotState = { error: string | null; sent: boolean };

/**
 * Send a password-reset link.
 *
 * Deliberately calls GoTrue's /recover endpoint directly instead of
 * `supabase.auth.resetPasswordForEmail`, because supabase-js uses PKCE and
 * PKCE is the wrong shape for a password reset.
 *
 * Under PKCE the library generates a secret "code verifier", keeps it in a
 * cookie in the browser that ASKED, and puts only its hash in the email. The
 * link is then usable from nowhere else, which breaks two ordinary things:
 *
 *   - Requesting a second link overwrites the verifier, so the first email
 *     stops working — and whoever clicks the older one is told it expired.
 *   - Opening the link on a phone, or in another browser, can never work at
 *     all. Nothing says so; it reports the same "expired or already used".
 *
 * Both happened here. The failure eventually named itself: "code challenge
 * does not match previously saved code verifier".
 *
 * With no code challenge GoTrue issues a stateless recovery link. It carries
 * its own one-time token, works from any device, and older links keep working
 * until they expire on their own — which is what a password reset should be.
 *
 * Always reports success, whatever happened, EXCEPT a rate limit. Saying "no
 * account with that address" would turn this form into a way of testing which
 * company addresses exist; a rate limit says nothing about the address, only
 * about how much mail the project has sent.
 */
export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address.", sent: false };

  // Built from the request rather than an env var: the link has to come back
  // to the host the person is actually using.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const redirectTo = `${proto}://${host}/reset-password`;

  let res: Response;
  try {
    res = await fetch(
      `${supabaseUrl()}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey(),
          Authorization: `Bearer ${supabaseAnonKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      }
    );
  } catch (e) {
    console.error("[forgot-password]", e);
    return {
      error: "Could not reach the authentication service. Try again shortly.",
      sent: false,
    };
  }

  if (res.status === 429)
    return {
      error:
        "Too many reset emails have been sent recently. Wait an hour and try " +
        "again, or ask an administrator to set your password directly.",
      sent: false,
    };

  if (!res.ok) console.error("[forgot-password]", res.status, await res.text());

  return { error: null, sent: true };
}
