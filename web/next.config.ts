import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * Sent on every response. None of these change how the app works; each removes
 * a way the browser could be talked into doing something on a user's behalf.
 *
 * No Content-Security-Policy yet, deliberately. Next injects inline scripts for
 * hydration, so a CSP needs per-request nonces threaded through the root layout
 * — worth doing, but done badly it either breaks the app or is so permissive it
 * proves nothing. The headers below are the ones that are correct as constants.
 */
const SECURITY_HEADERS = [
  {
    // Two years, subdomains included: the browser refuses plain HTTP to this
    // host from the first visit onwards, so a session cannot be stripped off
    // an http:// redirect on a shared network.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    // The app is never legitimately framed. Without this, a page elsewhere can
    // load it invisibly and capture clicks meant for its own UI — "approve
    // this PO" being exactly the sort of click worth stealing.
    key: "X-Frame-Options",
    value: "DENY",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    // Internal URLs carry sheet and PO ids. Same-origin keeps them out of the
    // Referer header sent to anything external.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Nothing here needs a camera, microphone or location, and saying so means
    // an injected script cannot ask on the user's behalf.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // The header leaks the framework version, which is free reconnaissance.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
