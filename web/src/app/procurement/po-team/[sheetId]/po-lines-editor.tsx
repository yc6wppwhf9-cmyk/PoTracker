"use client";

import { shortSite } from "@/lib/sites";

/**
 * A PO line as the PO team sees it: entirely read-only.
 *
 * The name is kept because "the editor" is what this area of the screen is,
 * and the type is referenced from the page.
 */
export type EditableLine = {
  id: string;
  item_code: string | null;
  name: string | null;
  lot: string | null;
  /** What the PO is being raised for. The buyer's number, not the PO team's. */
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

export function PoLinesEditor({ lines }: { lines: EditableLine[] }) {
  const total = lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0), 0);

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
              const q = Number(l.ordered_qty);
              return (
                <tr
                  key={l.id}
                  className="border-t border-black/5 dark:border-white/5"
                >
                  <td className="px-3 py-2">{l.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.item_code}</td>
                  <td className="px-3 py-2 text-neutral-500">{l.lot ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {Number(l.ordered_qty).toLocaleString()}
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

      {/* The quantity is the buyer's decision and the signed document is
          produced from it, so there is nothing to save here. An editable field
          let the record be moved to match the paperwork, in the one place a
          mismatch between the two is worth noticing. */}
      <p className="mt-3 text-xs tabular-nums text-neutral-500">
        PO total {total.toLocaleString()} · quantities are set by the buyer
      </p>

    </div>
  );
}
