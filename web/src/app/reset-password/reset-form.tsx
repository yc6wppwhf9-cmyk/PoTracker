"use client";

import { useActionState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { setNewPassword, type ResetState } from "./actions";

const initial: ResetState = { error: null };

export function ResetForm() {
  const [state, formAction, pending] = useActionState(setNewPassword, initial);

  useEffect(() => {
    // A recovery link in the implicit flow puts the tokens in the URL
    // FRAGMENT, which the server never sees. supabase-js reads it on the
    // client and stores the session; this only clears the fragment afterwards
    // so the tokens do not sit in the address bar.
    //
    // The form no longer waits for this. It used to render "Checking link…"
    // until the promise resolved, which meant any failure to reach Supabase —
    // or simply a blocked request — left the page with no form at all and
    // nothing to say why. The session now comes from /auth/callback before
    // this page renders, so there is nothing to wait for.
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && window.location.hash) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
      }
    });
  }, []);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <Field label="New password" name="password" autoFocus />
      <Field label="Confirm new password" name="confirm" />

      <p className="text-xs text-neutral-500">At least 8 characters.</p>

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
