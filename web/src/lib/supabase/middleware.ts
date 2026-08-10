import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { supabaseUrl, supabaseAnonKey } from "@/lib/env";

/** Public routes that never require an authenticated session. */
// /reset-password is reached from an emailed link, which is the whole point:
// the person cannot sign in, so requiring a session to set a new password
// would make the feature impossible to use.
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/forgot-password",
  "/reset-password",
];

/**
 * Refreshes the Supabase auth session on every request and gates access:
 * unauthenticated users hitting a protected route are bounced to /login.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Prefetches are let through without an auth call.
  //
  // getUser() is a NETWORK request to Supabase Auth, not a local check. The
  // sidebar renders a link per screen and Next prefetches each one it sees, so
  // a single page view fired a dozen or more of them — every one a round trip
  // to Tokyo, all of them ahead of the page the person actually asked for. The
  // auth log showed them arriving in bursts of thirty.
  //
  // Skipping is safe because a prefetch renders nothing a user sees: the real
  // navigation that follows is checked here, and every page independently
  // calls requireRole() before returning anything. RLS is behind both.
  if (request.headers.get("next-router-prefetch") === "1")
    return supabaseResponse;

  const supabase = createServerClient<Database>(
    supabaseUrl(),
    supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
