"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/api";

/**
 * Downloads a register as .xlsx.
 *
 * These lists get filtered, pivoted and mailed on by whoever receives them, so
 * the workbook is a flat sheet rather than the tabbed KPI report — a reviewer
 * doing their own analysis fights tabs.
 */
export function DownloadButton({
  path,
  filename,
  label,
}: {
  path: string;
  filename: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(path, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-lg border border-black/10 bg-white px-3.5 py-2 text-xs font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        {busy ? "Preparing…" : `⤓ ${label}`}
      </button>
      {error && (
        <span className="max-w-md text-right text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
