"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/api";

export function ExportButton({ sheetId }: { sheetId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(
        `/exports/rm-sheets/${sheetId}/reconciliation.xlsx`,
        "reconciliation.xlsx"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        {busy ? "Preparing…" : "⤓ Export KPI report (.xlsx)"}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
