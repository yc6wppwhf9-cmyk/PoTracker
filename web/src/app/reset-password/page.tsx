import Link from "next/link";
import { ResetForm } from "./reset-form";

/**
 * Where the reset form is shown, once /auth/callback has established a session.
 *
 * This page deliberately does NOT exchange the code any more. It used to, and
 * could not work: a Server Component cannot write cookies, so the exchange
 * spent the one-time code and then had nowhere to put the session. See
 * src/app/auth/callback/route.ts.
 *
 * The implicit flow puts tokens in the URL fragment instead, which the server
 * never sees — that case is still handled in the client component below.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error_description?: string }>;
}) {
  const { error_description } = await searchParams;
  const exchangeError: string | null = error_description ?? null;

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
