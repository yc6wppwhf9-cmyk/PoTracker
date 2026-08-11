"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PasswordField } from "@/components/password-field";

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
  /** Why a link was rejected, shown so a failure is diagnosable rather than
   *  the same sentence for every cause. */
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // The tokens are read out of the fragment BY HAND and handed to
    // setSession, rather than left to the library's detectSessionInUrl.
    //
    // createBrowserClient defaults to flowType "pkce", and whether it also
    // picks up implicit-flow tokens from a hash is an internal detail of
    // supabase-js — one this screen has already been burnt by twice. The auth
    // log proved the link itself was good (/verify returned 303 with
    // action=login) while the page still said it had expired, which means the
    // failure was here, in the reading of it. Doing it explicitly removes the
    // guesswork: the tokens either parse and are accepted, or they do not, and
    // either way this can say which.
    async function establish() {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(hash);

      // GoTrue reports its own failures in the fragment too.
      const linkError =
        params.get("error_description") ?? params.get("error");
      if (linkError) {
        setDetail(linkError.replace(/\+/g, " "));
        setPhase("invalid");
        return;
      }

      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (access_token && refresh_token) {
        const { error: err } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        // Cleared whether or not it worked: the tokens should not stay in the
        // address bar, in history, or in a screenshot of a failing page.
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
        if (err) {
          setDetail(err.message);
          setPhase("invalid");
          return;
        }
        setPhase("ready");
        return;
      }

      // No tokens in the URL. Either the page was opened directly, or a
      // session already exists — someone using "change my password" while
      // signed in lands here too.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setPhase("ready");
        return;
      }
      setDetail("The link contained no sign-in token.");
      setPhase("invalid");
    }

    establish();
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
          This link did not sign you in — it has expired, or a newer one has
          been sent.
          {detail && (
            <span className="mt-1 block text-xs opacity-80">{detail}</span>
          )}
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
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        autoFocus
        minLength={MIN_LENGTH}
        hint={`At least ${MIN_LENGTH} characters.`}
      />
      <PasswordField
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        minLength={MIN_LENGTH}
      />

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
