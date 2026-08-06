"use client";

import { useState } from "react";
import type { PendingPo } from "@/lib/pending-pos";

/**
 * Purchase orders with material still outstanding.
 *
 * Overdue and part-received are separated because they call for different
 * actions: an overdue order needs the supplier chased, a part-received one
 * needs a specific balance followed up, and an order not yet due needs only
 * watching. Collapsing them into one list would bury the urgent among the
 * merely open.
 */
export function PendingPos({ pos }: { pos: PendingPo[] }) {
  const [filter, setFilter] = useState<"all" | "overdue" | "none" | "part">(
    "overdue"
  );
  const [open, setOpen] = useState<string | null>(null);

  const overdue = pos.filter((p) => p.overdue);
  const none = pos.filter((p) => p.nothingReceived);
  const part = pos.filter((p) => !p.nothingReceived);
  const shown =
    filter === "overdue"
      ? overdue
      : filter === "none"
        ? none
        : filter === "part"
          ? part
          : pos;

  if (pos.length === 0)
    return (
      <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
        Every purchase order has been fully received.
      </p>
    );

  const tabs: [typeof filter, string, number][] = [
    ["overdue", "Overdue", overdue.length],
    ["part", "Part received", part.length],
    ["none", "Nothing received", none.length],
    ["all", "All open", pos.length],
  ];

  return (
    <div>
      <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              filter === key
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {label} ({n})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">PO number</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">ETD</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Received</th>
              <th className="px-4 py-3 text-right font-medium">Outstanding</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const outstanding = p.ordered - p.received;
              const pct = p.ordered > 0 ? p.received / p.ordered : 0;
              return (
                <>
                  <tr
                    key={p.id}
                    className="border-b border-black/5 last:border-0 dark:border-white/5"
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold">
                        {p.poNumber ?? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            no PO number
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {p.styleRef ?? p.sheetId.slice(0, 8)}
                        {p.site ? ` · ${p.site}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">{p.supplier ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                      {p.etd ?? <span className="text-neutral-400">no ETD</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.overdue ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            p.daysOverdue >= 14
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {p.daysOverdue}d late
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {p.etd ? "not due yet" : "no date"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.ordered.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.received.toLocaleString()}
                      {p.ordered > 0 && (
                        <span className="ml-1 text-xs text-neutral-400">
                          {Math.round(pct * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                      {outstanding.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(open === p.id ? null : p.id)}
                        className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {open === p.id ? "hide items" : `${p.lines.length} item(s)`}
                      </button>
                    </td>
                  </tr>
                  {open === p.id && (
                    <tr key={`${p.id}-detail`} className="bg-black/[0.02] dark:bg-white/[0.02]">
                      <td colSpan={8} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead className="text-left text-neutral-500">
                            <tr>
                              <th className="py-1 font-medium">Item</th>
                              <th className="py-1 font-medium">Lot</th>
                              <th className="py-1 text-right font-medium">Ordered</th>
                              <th className="py-1 text-right font-medium">Received</th>
                              <th className="py-1 text-right font-medium">Outstanding</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.lines.map((l, i) => {
                              const out = l.ordered - l.received;
                              return (
                                <tr key={`${l.itemCode}-${l.lot}-${i}`}>
                                  <td className="py-1">
                                    {l.name ?? l.itemCode}{" "}
                                    <span className="font-mono text-neutral-400">
                                      {l.itemCode}
                                    </span>
                                  </td>
                                  <td className="py-1 text-neutral-500">{l.lot ?? "—"}</td>
                                  <td className="py-1 text-right tabular-nums">
                                    {l.ordered.toLocaleString()}
                                  </td>
                                  <td className="py-1 text-right tabular-nums">
                                    {l.received.toLocaleString()}
                                  </td>
                                  <td
                                    className={`py-1 text-right tabular-nums ${
                                      out > 0
                                        ? "font-semibold text-rose-700 dark:text-rose-400"
                                        : "text-green-700 dark:text-green-400"
                                    }`}
                                  >
                                    {out > 0 ? out.toLocaleString() : "complete"}
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
