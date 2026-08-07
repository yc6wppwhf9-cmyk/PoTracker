"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

type Phase = "checking" | "ready" | "invalid" | "saving" | "done";

/**
 * Set a new password from a recovery link.
 *
 * Done entirely in the browser, on purpose. The recovery link now uses the
 * stateless flow, so it arrives carrying its own tokens in the URL fragment —
 * and a fragment is never sent to a server. supabase-js reads it, establishes
 * the session, and the update runs against that session.
 *
 * The earlier version split this across a Server Component and a server
 * action, which is where two separate failures came from: cookies cannot be
 * written during a render, and PKCE tied the link to the browser that asked
 * for it. Neither problem exists here, because nothing about this depends on
 * the server having seen anything.
 */
export function ResetForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // supabase-js consumes the fragment asynchronously on load, so a single
    // getSession() can run before it has finished. onAuthStateChange fires
    // when it does; the getSession below covers the case where it already had.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) return;
      setPhase("ready");
      // Keep the tokens out of the address bar, and out of anything the
      // browser syncs or a screenshot captures.
      if (window.location.hash)
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setPhase("ready");
        return;
      }
      // Give the fragment a moment to be consumed before calling it invalid.
      // Telling somebody holding a good link that it expired is the failure
      // this screen has already had twice.
      setTimeout(() => setPhase((p) => (p === "checking" ? "invalid" : p)), 1500);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    setError(null);
    if (password.length < MIN_LENGTH)
      return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords do not match.");

    setPhase("saving");
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });

    if (err) {
      setPhase("ready");
      return setError(err.message);
    }

    setPhase("done");
    // The recovery session is an ordinary session, so they are already signed
    // in. refresh() lets the server components see it.
    router.replace("/dashboard");
    router.refresh();
  }

  if (phase === "checking")
    return <p className="mt-6 text-sm text-neutral-400">Checking your link…</p>;

  if (phase === "invalid")
    return (
      <>
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          This link is no longer valid — it has expired, or a newer one has been
          sent.
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
    );

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <Field label="New password" name="password" autoFocus />
      <Field label="Confirm new password" name="confirm" />

      <p className="text-xs text-neutral-500">
        At least {MIN_LENGTH} characters.
      </p>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={phase === "saving" || phase === "done"}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {phase === "saving"
          ? "Saving…"
          : phase === "done"
            ? "Signing you in…"
            : "Set password and sign in"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  autoFocus,
}: {
  label: string;
  name: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type="password"
        autoComplete="new-password"
        required
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/15 dark:bg-neutral-950"
      />
    </label>
  );
}
