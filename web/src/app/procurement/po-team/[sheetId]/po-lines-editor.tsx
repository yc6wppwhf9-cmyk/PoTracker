"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePoLines, type LineEdit } from "../actions";

export type EditableLine = {
  id: string;
  item_code: string | null;
  name: string | null;
  lot: string | null;
  location: string | null;
  /** From the RM sheet — what was asked for. Read-only. */
  required: number | null;
  /** What the PO is actually being raised for. Editable. */
  ordered_qty: number;
  moq: number;
  /** Chosen by the buyer; shown here for reference. */
  supplier: string | null;
  rate: number | null;
  remark: string | null;
};

/** MOQ is the minimum a supplier accepts, so an order must round up to a whole
 *  multiple of it. Same formula as `expected_max` in the reconciliation view. */
export function moqRounded(qty: number, moq: number): number {
  if (!moq || moq <= 0) return qty;
  return Math.ceil(qty / moq) * moq;
}

export function PoLinesEditor({
  poId,
  lines,
  locked,
}: {
  poId: string;
  lines: EditableLine[];
  locked: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, { qty: string; moq: string }>>(
    Object.fromEntries(
      lines.map((l) => [l.id, { qty: String(l.ordered_qty), moq: String(l.moq) }])
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const belowMoq = lines.filter((l) => {
    const q = Number(rows[l.id]?.qty);
    const m = Number(rows[l.id]?.moq);
    return m > 0 && q > 0 && q < m;
  });

  function set(id: string, field: "qty" | "moq", value: string) {
    setSaved(false);
    setRows((r) => ({ ...r, [id]: { ...r[id], [field]: value } }));
  }

  function roundAllToMoq() {
    setSaved(false);
    setRows((r) => {
      const next = { ...r };
      for (const l of lines) {
        const q = Number(next[l.id]?.qty) || 0;
        const m = Number(next[l.id]?.moq) || 0;
        next[l.id] = { ...next[l.id], qty: String(moqRounded(q, m)) };
      }
      return next;
    });
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    const edits: LineEdit[] = lines.map((l) => ({
      id: l.id,
      ordered_qty: Number(rows[l.id]?.qty),
      moq: Number(rows[l.id]?.moq),
    }));
    const res = await savePoLines(poId, edits);
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  const total = lines.reduce((s, l) => s + (Number(rows[l.id]?.qty) || 0), 0);
  const totalRequired = lines.reduce((s, l) => s + (l.required ?? 0), 0);

  return (
    <div className="px-2 pb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Plant</th>
              <th className="px-3 py-2 font-medium">Lot</th>
              <th className="px-3 py-2 font-medium">Required</th>
              <th className="px-3 py-2 font-medium">PO qty</th>
              <th className="px-3 py-2 font-medium">MOQ</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">Rate</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const q = Number(rows[l.id]?.qty);
              const m = Number(rows[l.id]?.moq);
              const under = m > 0 && q > 0 && q < m;
              return (
                <tr
                  key={l.id}
                  className="border-t border-black/5 dark:border-white/5"
                >
                  <td className="px-3 py-2">{l.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.item_code}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {l.location ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{l.lot ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-400">
                    {l.required == null ? "—" : l.required.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {locked ? (
                      Number(l.ordered_qty).toLocaleString()
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={rows[l.id]?.qty ?? ""}
                        onChange={(e) => set(l.id, "qty", e.target.value)}
                        className={`w-28 rounded-md border px-2 py-1 text-sm tabular-nums dark:bg-neutral-950 ${
                          under
                            ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                            : "border-black/10 bg-white dark:border-white/15"
                        }`}
                      />
                    )}
                    {under && (
                      <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                        below MOQ → {moqRounded(q, m).toLocaleString()}
                      </div>
                    )}
                    {l.required != null && q > 0 && q !== l.required && (
                      <div
                        className={`mt-0.5 text-[11px] tabular-nums ${
                          q > l.required
                            ? "text-neutral-500"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {q > l.required
                          ? `+${(q - l.required).toLocaleString()} over required${
                              m > 0 && q === moqRounded(l.required, m)
                                ? " (MOQ)"
                                : ""
                            }`
                          : `${(q - l.required).toLocaleString()} short`}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {locked ? (
                      Number(l.moq).toLocaleString()
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={rows[l.id]?.moq ?? ""}
                        onChange={(e) => set(l.id, "moq", e.target.value)}
                        className="w-24 rounded-md border border-black/10 bg-white px-2 py-1 text-sm tabular-nums dark:border-white/15 dark:bg-neutral-950"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                    {l.supplier ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {l.rate == null ? "—" : l.rate.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {l.rate == null || !(q > 0)
                      ? "—"
                      : (l.rate * q).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">
                    {l.remark ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!locked && (
        <>
          {belowMoq.length > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {belowMoq.length} line(s) are below their MOQ. A supplier will not
              accept an order under the minimum — round up before attaching the
              document.
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {busy ? "Saving…" : "Save PO quantities"}
            </button>
            {belowMoq.length > 0 && (
              <button
                type="button"
                onClick={roundAllToMoq}
                className="rounded-lg border border-black/10 px-3 py-2 text-sm transition hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
              >
                Round all up to MOQ
              </button>
            )}
            <span className="text-xs tabular-nums text-neutral-500">
              Required {totalRequired.toLocaleString()} · PO{" "}
              {total.toLocaleString()}
            </span>
            {saved && (
              <span className="text-xs text-green-700 dark:text-green-400">
                ✓ Saved
              </span>
            )}
          </div>
        </>
      )}

      {locked && (
        <p className="mt-3 text-xs text-neutral-500">
          The document is attached, so quantities are locked. Detach or raise a
          new PO to change them.
        </p>
      )}
    </div>
  );
}
