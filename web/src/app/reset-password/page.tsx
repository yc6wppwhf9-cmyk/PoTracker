import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResetForm } from "./reset-form";

/**
 * Where the emailed reset link lands.
 *
 * Supabase's newer links carry a one-time `code` that has to be exchanged for
 * a session before anything can be changed. Older links, and the implicit
 * flow, put tokens in the URL fragment instead — the server never sees a
 * fragment, so that case is handled in the client component.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error_description?: string }>;
}) {
  const { code, error_description } = await searchParams;

  let exchangeError: string | null = error_description ?? null;
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) exchangeError = error.message;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <h1 className="text-xl font-semibold tracking-tight">
          Choose a new password
        </h1>

        {exchangeError ? (
          <>
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              This link is no longer valid — it has expired or has already been
              used.
            </p>
            <p className="mt-4 text-center text-sm">
              <Link
                href="/forgot-password"
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Send me a new one
              </Link>
            </p>
          </>
        ) : (
          <ResetForm />
        )}
      </div>
    </main>
  );
}
