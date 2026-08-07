"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotState } from "./actions";

const initial: ForgotState = { error: null, sent: false };

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initial
  );

  // Deliberately the same message whether or not the address is registered —
  // see the action. The form is replaced rather than left available, so it is
  // not obvious that resubmitting might say something different.
  if (state.sent)
    return (
      <p className="mt-6 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        If that address has an account, a reset link is on its way. It expires
        in an hour — check spam if it has not arrived in a few minutes.
      </p>
    );

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/15 dark:bg-neutral-950"
        />
      </label>

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
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
