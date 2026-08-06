import { createClient } from "@/lib/supabase/client";
import { cleanEnv } from "@/lib/env";

/** Absolute URL to a FastAPI endpoint. */
export function apiUrl(path: string): string {
  const base = apiBase();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Where the API lives, as the browser sees it. */
export function apiBase(): string {
  return (
    cleanEnv("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL) ||
    "http://localhost:8000"
  );
}

/**
 * Turn a network-level failure into something that names the cause.
 *
 * fetch() rejects with a bare "Failed to fetch" whether the host is wrong,
 * unreachable, or blocked by CORS — and the commonest cause by far is
 * NEXT_PUBLIC_API_BASE_URL being unset in the browser bundle, which leaves it
 * pointing at localhost on the user's own machine.
 */
function describeNetworkFailure(e: unknown): Error {
  const base = apiBase();
  const local = base.includes("localhost") || base.includes("127.0.0.1");
  if (local)
    return new Error(
      `Could not reach the API at ${base}. NEXT_PUBLIC_API_BASE_URL is not set ` +
        "in this deployment, so the browser is calling your own machine. Set it " +
        "to the API URL and redeploy — it is baked in at build time."
    );
  return new Error(
    `Could not reach the API at ${base} (${
      e instanceof Error ? e.message : "network error"
    }). Check the service is running and that this site is in ALLOWED_ORIGINS.`
  );
}

/** Current user's Supabase access token (JWT) for Authorization: Bearer. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * GET a file from FastAPI and save it. The endpoint needs the caller's bearer
 * token, so a plain <a href> cannot be used — fetch it, then hand the blob to
 * a throwaway anchor.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw describeNetworkFailure(e);
  }
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      /* not JSON — use the raw body */
    }
    throw new Error(detail || `Download failed (${res.status})`);
  }

  // Prefer the server's filename, which carries the sheet reference.
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const name = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** POST a FormData body to FastAPI with the caller's bearer token. */
export async function postForm<T = unknown>(
  path: string,
  form: FormData
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (e) {
    throw describeNetworkFailure(e);
  }

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
