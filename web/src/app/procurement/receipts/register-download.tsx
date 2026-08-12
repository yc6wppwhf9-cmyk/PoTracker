"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/api";

/**
 * Date-wise download of the GRN register.
 *
 * The register runs to thousands of lines, so a single "download everything"
 * button hands back a workbook nobody wants to open. Both dates are optional:
 * pick a From, a To, both for a window, or neither for the whole register. The
 * bounds are passed to /exports/grn-register.xlsx, which filters on the GRC
 * date server-side and names the file after the range it contains.
 */
export function RegisterDownload() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A backwards range is caught here so the user gets an answer immediately,
  // rather than a round-trip to the API for the same 400.
  const rangeBackwards = from !== "" && to !== "" && from > to;

  async function onDownload() {
    if (rangeBackwards) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      // The server sets the real filename (with the range) via
      // Content-Disposition; this is only the fallback if that header is
      // missing.
      await downloadFile(
        `/exports/grn-register.xlsx${qs ? `?${qs}` : ""}`,
        "grn-register.xlsx"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-neutral-900 dark:border-white/15 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-neutral-900 dark:border-white/15 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy || rangeBackwards}
          className="rounded-lg border border-black/10 bg-white px-3.5 py-2 text-xs font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          {busy ? "Preparing…" : "⤓ Download register"}
        </button>
      </div>
      <p className="text-right text-[11px] text-neutral-400">
        Leave both dates empty for the whole register.
      </p>
      {rangeBackwards && (
        <span className="max-w-md text-right text-xs text-red-600 dark:text-red-400">
          “From” is after “To” — pick an earlier start date.
        </span>
      )}
      {error && (
        <span className="max-w-md text-right text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
