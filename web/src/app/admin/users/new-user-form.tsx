"use client";

import { useActionState, useState } from "react";
import { createUser, type CreateUserState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/roles";

const initial: CreateUserState = { error: null, ok: false, email: null };

/**
 * Add a login without leaving the app.
 *
 * Behind a disclosure rather than always open: the list is what this page is
 * for, and creating an account is occasional. Collapsed, it does not push the
 * table down the screen every time somebody comes here to change a role.
 */
export function NewUserForm() {
  const [state, formAction, pending] = useActionState(createUser, initial);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  /** A password the admin can read out, rather than one they invent badly. */
  function suggest() {
    const words = ["amber", "cotton", "harbour", "lantern", "meadow", "pilot",
      "quartz", "ribbon", "silver", "timber", "velvet", "willow"];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(Math.random() * 90) + 10;
    setPassword(`${pick()}-${pick()}-${n}`);
  }

  if (state.ok)
    return (
      <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <strong>{state.email}</strong> can now sign in with the password you
        set. Ask them to change it — the sign-in page has a “Forgot your
        password?” link that lets them set their own.
        <div className="mt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs font-medium underline"
          >
            Add another
          </button>
        </div>
      </div>
    );

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        + Add user
      </button>
    );

  return (
    <form
      action={formAction}
      className="mb-6 rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-neutral-900"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Full name</span>
          <input name="full_name" className={FIELD} placeholder="Asha Verma" />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            className={FIELD}
            placeholder="name@hscvpl.com"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Starting password
          </span>
          <div className="flex gap-2">
            <input
              name="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
              placeholder="at least 10 characters"
            />
            <button
              type="button"
              onClick={suggest}
              className="whitespace-nowrap rounded-lg border border-black/10 px-3 text-xs font-medium hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
            >
              Suggest
            </button>
          </div>
          {/* Shown in plain text on purpose: the admin has to pass it on, and
              a password they cannot read is one they will write down badly. */}
          <span className="mt-1 block text-xs text-neutral-500">
            Give this to the person; they can change it from the sign-in page.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Role</span>
          <select name="role" defaultValue="uploader" className={FIELD}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Creating…" : "Create user"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-neutral-500 hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const FIELD =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/15 dark:bg-neutral-950";
