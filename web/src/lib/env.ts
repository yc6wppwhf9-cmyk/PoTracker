/**
 * Read an environment variable, tolerating a pasted `NAME=value` line.
 *
 * Hosting dashboards (Vercel, Render) have separate Key and Value fields, and
 * pasting the whole `NAME=https://…` line into Value is easy to do and hard to
 * see afterwards. The symptom is remote and confusing rather than local and
 * obvious: a malformed Supabase URL produces "fetch failed" at sign-in, which
 * says nothing about which variable is wrong.
 *
 * Surrounding quotes and whitespace are stripped for the same reason — both
 * survive a copy-paste, and neither is ever meant literally.
 *
 * NOTE: `process.env.X` must be written out in full at each call site rather
 * than looked up dynamically. Next.js inlines NEXT_PUBLIC_* variables into the
 * client bundle by matching the literal text, so `process.env[name]` would
 * simply be undefined in the browser.
 */
export function cleanEnv(name: string, raw: string | undefined): string {
  let v = (raw ?? "").trim();
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'"))
    v = v.slice(1, -1).trim();
  return v;
}

/** The Supabase project URL, normalised, without a trailing slash. */
export function supabaseUrl(): string {
  return cleanEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ).replace(/\/+$/, "");
}

/** The Supabase anon/publishable key, normalised. */
export function supabaseAnonKey(): string {
  return cleanEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
