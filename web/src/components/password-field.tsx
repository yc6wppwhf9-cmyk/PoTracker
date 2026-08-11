"use client";

import { useId, useState } from "react";

/**
 * A password box you can look inside.
 *
 * Worth having rather than a nicety: people mistype passwords they cannot see,
 * and the ones this app hands out are generated — `harbour-quartz-47` typed
 * blind from a message is a failed sign-in and a support call, not a security
 * measure. Being able to check what you typed is the difference between a
 * person getting in and a person asking an administrator to reset it.
 *
 * Starts hidden, so nothing is revealed to somebody walking past unless the
 * person at the keyboard asks for it. The button is a real <button> with a
 * label that changes, so it is reachable by keyboard and announced properly
 * rather than being an icon a screen reader has to guess at.
 */
export function PasswordField({
  label,
  name,
  autoComplete = "current-password",
  autoFocus,
  required = true,
  minLength,
  hint,
}: {
  label: string;
  name: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  minLength?: number;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div className="block">
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          minLength={minLength}
          // Room on the right for the button, so a long password does not run
          // underneath it.
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 pr-11 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 dark:border-white/10 dark:bg-neutral-950 dark:focus:ring-neutral-700"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          // tabIndex -1 would keep it out of the way of the submit flow, but
          // then a keyboard user cannot reach the one control that tells them
          // what they typed — which is exactly who needs it.
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          title={shown ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-neutral-400 transition hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:text-neutral-200"
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {hint && (
        <p className="mt-1 text-xs text-neutral-500">{hint}</p>
      )}
    </div>
  );
}

function Eye() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M9.9 5.7A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9M6.2 7.2A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"
      />
    </svg>
  );
}
