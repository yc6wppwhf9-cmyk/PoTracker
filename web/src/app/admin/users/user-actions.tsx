"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUser, disableUser, enableUser } from "./actions";

/**
 * Ending someone's access.
 *
 * Disable is offered first and delete second, which is the opposite of what
 * people ask for and the right way round. Almost everyone here has uploaded a
 * sheet, raised a PO or appears in the audit trail, and those rows must not
 * lose their author — the database refuses to delete such an account, and
 * should. Disabling ends access immediately, keeps the history, and can be
 * undone; deletion is for the wrong address typed last week.
 *
 * The admin's own row gets neither control. Locking yourself out is not a
 * mistake the application should make available.
 */
export function UserActions({
  userId,
  email,
  isSelf,
}: {
  userId: string;
  email: string | null;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"disable" | "delete" | null>(null);

  if (isSelf)
    return <span className="text-xs text-neutral-400">that&apos;s you</span>;

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setConfirming(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {error && (
        <span className="block w-full text-right text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}

      {confirming === null && (
        <>
          <button
            type="button"
            onClick={() => setConfirming("disable")}
            disabled={pending}
            className="rounded-md border border-black/10 px-2 py-1 font-medium hover:bg-neutral-50 disabled:opacity-40 dark:border-white/15 dark:hover:bg-neutral-800"
          >
            Disable
          </button>
          <button
            type="button"
            onClick={() => setConfirming("delete")}
            disabled={pending}
            className="rounded-md px-2 py-1 font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Delete
          </button>
        </>
      )}

      {confirming && (
        <>
          {/* The address is repeated in the confirmation. A row of identical
              buttons is easy to press against the wrong line, and the name is
              the only thing that catches it. */}
          <span className="text-neutral-500">
            {confirming === "disable" ? "Disable" : "Permanently delete"}{" "}
            <strong className="font-medium">{email}</strong>?
          </span>
          <button
            type="button"
            onClick={() =>
              run(() =>
                confirming === "disable"
                  ? disableUser(userId)
                  : deleteUser(userId)
              )
            }
            disabled={pending}
            className={`rounded-md px-2 py-1 font-semibold text-white disabled:opacity-40 ${
              confirming === "disable"
                ? "bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                : "bg-rose-600 hover:bg-rose-500"
            }`}
          >
            {pending ? "Working…" : "Yes"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            disabled={pending}
            className="text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            Cancel
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => run(() => enableUser(userId))}
        disabled={pending}
        title="Restore access to an account that was disabled"
        className="text-neutral-400 underline hover:text-neutral-700 disabled:opacity-40 dark:hover:text-neutral-200"
      >
        Re-enable
      </button>
    </span>
  );
}
