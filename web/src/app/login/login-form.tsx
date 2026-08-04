"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

const initial: AuthState = { error: null };

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-neutral-900">
      <h1 className="text-xl font-semibold tracking-tight">
        RM → PO Reconciliation
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {mode === "signin" ? "Sign in to continue." : "Create an account."}
      </p>

      <div className="mt-6 flex rounded-lg bg-neutral-100 p-1 text-sm dark:bg-neutral-800">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`flex-1 rounded-md px-3 py-1.5 transition ${
            mode === "signin"
              ? "bg-white shadow-sm dark:bg-neutral-700"
              : "text-neutral-500"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-md px-3 py-1.5 transition ${
            mode === "signup"
              ? "bg-white shadow-sm dark:bg-neutral-700"
              : "text-neutral-500"
          }`}
        >
          Sign up
        </button>
      </div>

      <form action={formAction} className="mt-6 space-y-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {mode === "signup" && (
          <Field
            label="Full name"
            name="full_name"
            type="text"
            autoComplete="name"
          />
        )}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
        />

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
          {pending
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 dark:border-white/10 dark:bg-neutral-950 dark:focus:ring-neutral-700"
      />
    </label>
  );
}
