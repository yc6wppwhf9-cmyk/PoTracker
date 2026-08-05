"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSheetAction } from "./actions";

/**
 * Deleting a sheet is irreversible and cascades through its requirements, POs
 * and approvals, so the action returns its refusals rather than throwing —
 * production replaces a thrown server error with a generic dialog, which turned
 * "3,410 lines are assigned to buyers" into "an error occurred".
 */
export function DeleteSheetBtn({
  sheetId,
  styleRef,
}: {
  sheetId: string;
  styleRef?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    const name = styleRef ? `"${styleRef}"` : "this RM sheet";
    if (
      !confirm(
        `Delete ${name} and everything belonging to it?\n\n` +
          "Its requirement lines, PO drafts and approvals are removed. " +
          "This cannot be undone."
      )
    )
      return;

    setLoading(true);
    const res = await deleteSheetAction(sheetId);
    setLoading(false);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={loading}
        className="ml-2 cursor-pointer rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
      >
        {loading ? "Deleting..." : "🗑 Delete"}
      </button>
      {error && (
        <span className="max-w-xs text-right text-xs font-normal text-rose-700 dark:text-rose-300">
          {error}
        </span>
      )}
    </span>
  );
}
