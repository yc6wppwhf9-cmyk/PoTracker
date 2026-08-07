"use client";

import { useMemo, useState } from "react";
import type { SupplierGroup } from "@/lib/supplier-orders";
import { formatDate } from "@/lib/format";
import { shortSite } from "@/lib/sites";

const qty = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * One card per supplier, expandable to the individual materials.
 *
 * Collapsed by default: the point of this screen is to decide who to call, and
 * the detail only matters once that is decided.
 */
export function SupplierList({ groups }: { groups: SupplierGroup[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.supplier.toLowerCase().includes(q) ||
        g.poNumbers.some((n) => n.toLowerCase().includes(q)) ||
        g.lines.some(
          (l) =>
            (l.itemCode ?? "").toLowerCase().includes(q) ||
            (l.name ?? "").toLowerCase().includes(q)
        )
    );
  }, [groups, query]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search supplier, PO number, item…"
        className="mb-4 w-full max-w-md rounded-xl border border-black/10 bg-white px-3.5 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-neutral-900"
      />

      <div className="space-y-3">
        {visible.map((g) => (
          <div
            key={g.supplier}
            className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <div className="font-semibold">{g.supplier}</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {g.items} item(s) ·{" "}
                  {g.poNumbers.length > 0
                    ? g.poNumbers.join(", ")
                    : "no PO number captured"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm">
                {g.worstOverdue > 0 && (
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                    {g.worstOverdue} day(s) late
                  </span>
                )}
                {/* Stated separately from "late": a supplier who has sent
                    nothing at all is a different conversation from one who
                    part-delivered. */}
                {g.nothingReceived && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    nothing received
                  </span>
                )}
                <span className="tabular-nums text-neutral-500">
                  {qty(g.outstanding)} outstanding
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(open === g.supplier ? null : g.supplier)}
                  className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {open === g.supplier ? "hide items" : "view items"}
                </button>
              </div>
            </div>

            {open === g.supplier && (
              <div className="overflow-x-auto border-t border-black/5 px-5 py-3 dark:border-white/5">
                <table className="w-full text-xs">
                  <thead className="text-left text-neutral-500">
                    <tr>
                      <th className="py-1 font-medium">Item</th>
                      <th className="py-1 font-medium">Item code</th>
                      <th className="py-1 font-medium">PO</th>
                      <th className="py-1 font-medium">ETD</th>
                      <th className="py-1 font-medium">Site</th>
                      <th className="py-1 text-right font-medium">Ordered</th>
                      <th className="py-1 text-right font-medium">Received</th>
                      <th className="py-1 text-right font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-1">{l.name ?? l.itemCode}</td>
                        <td className="py-1 font-mono text-neutral-500">
                          {l.itemCode ?? "—"}
                        </td>
                        <td className="py-1 font-mono text-neutral-500">
                          {l.poNumber ?? "—"}
                        </td>
                        <td
                          className={`py-1 ${
                            l.overdue
                              ? "font-semibold text-rose-700 dark:text-rose-400"
                              : "text-neutral-500"
                          }`}
                        >
                          {l.etd ? formatDate(l.etd) : "—"}
                        </td>
                        <td className="py-1 text-neutral-500">
                          {shortSite(l.site)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {qty(l.ordered)}
                        </td>
                        <td className="py-1 text-right tabular-nums text-neutral-500">
                          {qty(l.received)}
                        </td>
                        <td className="py-1 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                          {qty(l.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {visible.length === 0 && (
          <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            {query
              ? `Nothing outstanding matching "${query}".`
              : "Nothing outstanding with any supplier."}
          </p>
        )}
      </div>
    </div>
  );
}
