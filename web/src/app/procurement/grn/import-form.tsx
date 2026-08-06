"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postForm } from "@/lib/api";

type ImportResult = {
  imported: number;
  receipts?: number;
  merged_duplicate_lines?: number;
  skipped_no_grc?: number;
  skipped_no_qty?: number;
  reason?: string;
  counts?: {
    matched_lines: number;
    unmatched_lines: number;
    lines_without_po_number: number;
  };
  unmatched_po_numbers?: string[];
  over_received?: {
    lines: number;
    examples: {
      po_number: string;
      item_code: string;
      lot: string | null;
      ordered: number;
      received: number;
      excess: number;
    }[];
  };
};

export function GrnImportForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setResult(await postForm<ImportResult>("/grn/import", fd));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const c = result?.counts;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        onChange={onChange}
        disabled={busy}
        className="hidden"
        id="grn-file"
      />
      <label
        htmlFor="grn-file"
        className="inline-block cursor-pointer rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Importing…" : "Choose GRN register (.xlsx)"}
      </label>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-black/10 bg-white p-4 text-sm dark:border-white/10 dark:bg-neutral-900">
          <p className="font-medium">
            {result.imported.toLocaleString()} receipt line(s) imported
            {result.receipts ? ` across ${result.receipts} GRC number(s)` : ""}.
          </p>
          {result.reason && (
            <p className="mt-1 text-neutral-500">{result.reason}</p>
          )}

          {c && (
            <ul className="mt-3 space-y-1 text-xs">
              <li className="text-green-700 dark:text-green-400">
                {c.matched_lines.toLocaleString()} line(s) matched a known PO number.
              </li>
              {c.unmatched_lines > 0 && (
                <li className="text-amber-700 dark:text-amber-400">
                  {c.unmatched_lines.toLocaleString()} line(s) quote a PO number
                  this system does not know
                  {result.unmatched_po_numbers?.length
                    ? ` — e.g. ${result.unmatched_po_numbers.join(", ")}`
                    : ""}
                  . Usually the PO number was never captured from its document.
                </li>
              )}
              {c.lines_without_po_number > 0 && (
                <li className="text-neutral-500">
                  {c.lines_without_po_number.toLocaleString()} line(s) carry no PO
                  number at all, so they cannot be matched.
                </li>
              )}
            </ul>
          )}

          {/* Surfaced here because this is the moment it becomes true, and the
              person importing is the one who can query the invoice. */}
          {result.over_received && result.over_received.lines > 0 && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs dark:border-rose-900 dark:bg-rose-950/40">
              <p className="font-semibold text-rose-800 dark:text-rose-300">
                {result.over_received.lines} line(s) have now received more than
                the PO ordered.
              </p>
              <ul className="mt-1 space-y-0.5 text-rose-700 dark:text-rose-400">
                {result.over_received.examples.map((e, i) => (
                  <li key={`${e.po_number}-${e.item_code}-${i}`}>
                    <span className="font-mono">{e.po_number}</span> ·{" "}
                    <span className="font-mono">{e.item_code}</span>
                    {e.lot ? ` · ${e.lot}` : ""} — ordered{" "}
                    {e.ordered.toLocaleString()}, received{" "}
                    {e.received.toLocaleString()} (
                    <strong>+{e.excess.toLocaleString()}</strong>)
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-rose-600 dark:text-rose-400">
                The full list, with values and which delivery pushed each line
                over, is on the approver dashboard.
              </p>
            </div>
          )}

          {/* Skips are reported rather than silent: an unnoticed skip is a
              delivery that never appears against its order. */}
          {(result.skipped_no_qty || result.skipped_no_grc || result.merged_duplicate_lines) ? (
            <ul className="mt-3 space-y-1 text-xs text-neutral-500">
              {result.skipped_no_qty ? (
                <li>
                  {result.skipped_no_qty} row(s) skipped with a zero or negative
                  quantity — those are corrections, not goods arriving.
                </li>
              ) : null}
              {result.skipped_no_grc ? (
                <li>{result.skipped_no_grc} row(s) skipped with no GRC number.</li>
              ) : null}
              {result.merged_duplicate_lines ? (
                <li>
                  {result.merged_duplicate_lines} repeated line(s) summed into
                  their existing receipt.
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
