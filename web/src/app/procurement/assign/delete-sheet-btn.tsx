"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSheetAction } from "./actions";

export function DeleteSheetBtn({ sheetId }: { sheetId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this RM Sheet and all its data?")) {
      return;
    }
    setLoading(true);
    try {
      await deleteSheetAction(sheetId);
      router.refresh();
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to delete sheet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60 cursor-pointer ml-2"
    >
      {loading ? "Deleting..." : "🗑 Delete"}
    </button>
  );
}
