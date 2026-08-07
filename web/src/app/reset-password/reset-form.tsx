"use client";

import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setNewPassword, type ResetState } from "./actions";

const initial: ResetState = { error: null };

export function ResetForm() {
  const [state, formAction, pending] = useActionState(setNewPassword, initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // A recovery link in the implicit flow puts the tokens in the URL
    // FRAGMENT, which is never sent to the server — so the page renders with
    // no session and the form would fail on submit. supabase-js reads the
    // fragment on the client and stores the session; this waits for that, then
    // clears the fragment so the tokens do not sit in the address bar or in
    // whatever the browser syncs.
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && window.location.hash) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
      }
      setReady(true);
    });
  }, []);

  if (!ready)
    return <p className="mt-6 text-sm text-neutral-400">Checking link…</p>;

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <Field label="New password" name="password" autoFocus />
      <Field label="Confirm new password" name="confirm" />

      <p className="text-xs text-neutral-500">At least 10 characters.</p>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {pending ? "Saving…" : "Set password and sign in"}
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
