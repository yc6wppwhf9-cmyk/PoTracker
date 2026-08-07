import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where an emailed auth link lands, so the code can be exchanged for a session
 * somewhere cookies can actually be written.
 *
 * This exists because /reset-password did the exchange itself, in a Server
 * Component, and that cannot work:
 *
 *   - `exchangeCodeForSession` succeeds at Supabase and CONSUMES the one-time
 *     code, then tries to store the session in a cookie.
 *   - Next forbids setting cookies during a Server Component render. Our
 *     cookie adapter swallows that (it has to — the same client is used for
 *     ordinary page reads), so nothing is raised.
 *   - The session is therefore never persisted, while the code is spent. Any
 *     re-render — a refresh, a back button, Next fetching the RSC payload —
 *     exchanges the same code again and gets "invalid", which is what the
 *     page then reports as "this link has expired or has already been used".
 *
 * The auth logs said as much: /verify returned 303 with action=login from the
 * user's own address, so the link was genuinely valid at the moment it was
 * clicked. Nothing was expired; the session simply had nowhere to go.
 *
 * A Route Handler can set cookies. It exchanges once, writes the session, and
 * redirects — so the page that renders next is an ordinary signed-in page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Only same-origin relative paths, or this becomes an open redirect that
  // borrows the credibility of a link we sent ourselves.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!code)
    return NextResponse.redirect(`${origin}/login?error=missing_code`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error)
    return NextResponse.redirect(
      `${origin}/reset-password?error_description=${encodeURIComponent(error.message)}`
    );

  return NextResponse.redirect(`${origin}${target}`);
}
