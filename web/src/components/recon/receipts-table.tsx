import type { ReceiptRow } from "@/lib/receipts";

/**
 * What the GRN register recorded as arriving, beside what it was ordered
 * against. Over-received rows are tinted, since an excess is the reason to
 * read the table rather than something to be found inside it.
 */
export function ReceiptsTable({ rows }: { rows: ReceiptRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
          <tr>
            <th className="px-4 py-3 font-medium">GRC</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">PO number</th>
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium">Lot</th>
            <th className="px-4 py-3 text-right font-medium">This receipt</th>
            <th className="px-4 py-3 text-right font-medium">Ordered</th>
            <th className="px-4 py-3 text-right font-medium">Received</th>
            <th className="px-4 py-3 text-right font-medium">Excess</th>
            <th className="px-4 py-3 font-medium">Supplier</th>
            {/* Who raised the order — the person to ask when a delivery is
                short or over, rather than a PO number to look up first. */}
            <th className="px-4 py-3 font-medium">Buyer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.grcNo}-${r.itemCode ?? ""}-${i}`}
              className={`border-b border-black/5 last:border-0 dark:border-white/5 ${
                r.excess != null ? "bg-rose-50/60 dark:bg-rose-950/20" : ""
              }`}
            >
              <td className="px-4 py-3 font-mono text-xs">{r.grcNo}</td>
              <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                {r.grcDate ?? "—"}
              </td>
              <td className="px-4 py-3 font-mono text-xs">
                {r.poNumber ?? <span className="font-sans text-neutral-400">—</span>}
              </td>
              <td className="px-4 py-3 font-mono text-xs">{r.itemCode ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-500">{r.lot ?? "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.qty.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                {r.ordered == null ? (
                  <span title="No purchase order in this system carries that PO number and item. Usually the PO was raised elsewhere, or its number was never captured from the attached document.">
                    no match
                  </span>
                ) : (
                  r.ordered.toLocaleString()
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.received.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.excess == null ? (
                  <span className="text-neutral-300">—</span>
                ) : (
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    +{r.excess.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                {r.supplier ?? "—"}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                {r.buyer ?? "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={11} className="px-4 py-8 text-center text-neutral-500">
                No receipts imported yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
