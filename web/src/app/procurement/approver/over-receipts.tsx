"use client";

import { useState } from "react";
import type { OverReceiptLine } from "@/lib/over-receipts";
import { shortSite } from "@/lib/sites";

/**
 * Material received in excess of the purchase order.
 *
 * Separate from the pending list, which is about goods not arriving. This is
 * the opposite failure and needs a different response: an invoice to query
 * rather than a supplier to chase.
 */
export function OverReceipts({ lines }: { lines: OverReceiptLine[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (lines.length === 0)
    return (
      <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
        No delivery has exceeded its purchase order.
      </p>
    );

  const totalValue = lines.reduce((s, l) => s + (l.excessValue ?? 0), 0);
  // An excess that still leaves the sheet short is not surplus — it is filling
  // a gap left by an order that was under the requirement.
  const genuineSurplus = lines.filter(
    (l) => l.vsRequired != null && l.vsRequired > 0
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-neutral-500">
        <span>
          <strong className="text-neutral-800 dark:text-neutral-200">
            {lines.length}
          </strong>{" "}
          line(s) over-delivered
        </span>
        {totalValue > 0 && (
          <span>
            Excess worth{" "}
            <strong className="tabular-nums text-rose-700 dark:text-rose-400">
              {totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </strong>
          </span>
        )}
        <span>
          <strong className="text-neutral-800 dark:text-neutral-200">
            {genuineSurplus.length}
          </strong>{" "}
          leave more than the sheet required
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">PO number</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Received</th>
              <th className="px-4 py-3 text-right font-medium">Excess</th>
              <th className="px-4 py-3 text-right font-medium">Excess value</th>
              <th className="px-4 py-3 font-medium">vs sheet</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const id = `${l.poId}-${l.itemCode}-${l.lot ?? ""}`;
              const overPct = l.ordered > 0 ? l.excess / l.ordered : 0;
              return (
                <>
                  <tr
                    key={id}
                    className="border-b border-black/5 last:border-0 dark:border-white/5"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.name ?? l.itemCode}</div>
                      <div className="text-xs text-neutral-500">
                        <span className="font-mono">{l.itemCode}</span>
                        {l.lot ? ` · ${l.lot}` : ""}
                        {l.site ? ` · ${shortSite(l.site)}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {l.poNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3">{l.supplier ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.ordered.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {l.received.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                        +{l.excess.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                      <span className="ml-1 text-xs text-neutral-400">
                        {Math.round(overPct * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.excessValue == null ? (
                        <span className="text-neutral-400">no rate</span>
                      ) : (
                        l.excessValue.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {l.vsRequired == null ? (
                        <span className="text-neutral-400">—</span>
                      ) : l.vsRequired > 0 ? (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                          +{l.vsRequired.toLocaleString(undefined, { maximumFractionDigits: 2 })} surplus
                        </span>
                      ) : (
                        <span
                          className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          title="The PO was under the sheet requirement, so this over-delivery fills a shortfall rather than creating surplus."
                        >
                          fills a shortfall
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(open === id ? null : id)}
                        className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {open === id ? "hide" : `${l.receipts.length} receipt(s)`}
                      </button>
                    </td>
                  </tr>
                  {open === id && (
                    <tr key={`${id}-d`} className="bg-black/[0.02] dark:bg-white/[0.02]">
                      <td colSpan={9} className="px-4 py-3">
                        {/* Which delivery pushed it over is the first thing
                            asked when querying an invoice. */}
                        <table className="text-xs">
                          <thead className="text-left text-neutral-500">
                            <tr>
                              <th className="py-1 pr-6 font-medium">GRC</th>
                              <th className="py-1 pr-6 font-medium">Date</th>
                              <th className="py-1 pr-6 text-right font-medium">Qty</th>
                              <th className="py-1 text-right font-medium">Running</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.receipts.map((r, i) => {
                              const running = l.receipts
                                .slice(0, i + 1)
                                .reduce((s, x) => s + x.qty, 0);
                              const over = running > l.ordered;
                              return (
                                <tr key={`${r.grcNo}-${i}`}>
                                  <td className="py-1 pr-6 font-mono">{r.grcNo}</td>
                                  <td className="py-1 pr-6 text-neutral-500">
                                    {r.grcDate ?? "—"}
                                  </td>
                                  <td className="py-1 pr-6 text-right tabular-nums">
                                    {r.qty.toLocaleString()}
                                  </td>
                                  <td
                                    className={`py-1 text-right tabular-nums ${
                                      over
                                        ? "font-semibold text-rose-700 dark:text-rose-400"
                                        : "text-neutral-500"
                                    }`}
                                  >
                                    {running.toLocaleString()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
