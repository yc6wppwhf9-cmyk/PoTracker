"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePoLines, type LineEdit } from "../actions";
import { shortSite } from "@/lib/sites";

export type EditableLine = {
  id: string;
  item_code: string | null;
  name: string | null;
  lot: string | null;
  /** What the PO is actually being raised for. Editable. */
  ordered_qty: number;
  /** Chosen by the buyer; shown here for reference. */
  supplier: string | null;
  rate: number | null;
  remark: string | null;
  /** Set by the buyer per line — one order can ship to two sites on two
   *  dates. Falls back to the PO's own values for orders raised before they
   *  moved down onto the line. */
  etd: string | null;
  site: string | null;
};

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
  const [rows, setRows] = useState<Record<string, { qty: string }>>(
    Object.fromEntries(lines.map((l) => [l.id, { qty: String(l.ordered_qty) }]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set(id: string, field: "qty", value: string) {
    setSaved(false);
    setRows((r) => ({ ...r, [id]: { ...r[id], [field]: value } }));
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    const edits: LineEdit[] = lines.map((l) => ({
      id: l.id,
      ordered_qty: Number(rows[l.id]?.qty),
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

  return (
    <div className="px-2 pb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Lot</th>
              <th className="px-3 py-2 font-medium">PO qty</th>
              <th className="px-3 py-2 font-medium">ETD</th>
              <th className="px-3 py-2 font-medium">Delivery site</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">Rate</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const q = Number(rows[l.id]?.qty);
              return (
                <tr
                  key={l.id}
                  className="border-t border-black/5 dark:border-white/5"
                >
                  <td className="px-3 py-2">{l.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.item_code}</td>
                  <td className="px-3 py-2 text-neutral-500">{l.lot ?? "—"}</td>
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
                        className="w-28 rounded-md border border-black/10 bg-white px-2 py-1 text-sm tabular-nums dark:border-white/15 dark:bg-neutral-950"
                      />
                    )}
                  </td>
                  {/* Per line, matching the signed document, which prints the
                      date and ship-to beside every item. */}
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                    {l.etd ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                    {l.site ? shortSite(l.site) : "—"}
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
            <span className="text-xs tabular-nums text-neutral-500">
              PO total {total.toLocaleString()}
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
