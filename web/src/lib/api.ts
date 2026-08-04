import { createClient } from "@/lib/supabase/client";

/** Absolute URL to a FastAPI endpoint. */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Current user's Supabase access token (JWT) for Authorization: Bearer. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** POST a FormData body to FastAPI with the caller's bearer token. */
export async function postForm<T = unknown>(
  path: string,
  form: FormData
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");

  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const detail =
      (body as { detail?: string })?.detail ??
      (typeof body === "string" ? body : `Request failed (${res.status})`);
    throw new Error(detail);
  }
  return body as T;
}
