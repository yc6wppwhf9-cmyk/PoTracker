"use client";

import { useMemo, useState } from "react";
import type { PendingLine } from "@/lib/pending-pos";
import { shortSite } from "@/lib/sites";
import { DownloadButton } from "./download-button";

/**
 * One row per outstanding item, not per PO.
 *
 * Chasing a supplier is about a specific material, so the item belongs on the
 * row rather than behind an expander. A flat list is also what makes searching
 * and filtering by buyer possible in one pass.
 *
 * The groups stay separated because they call for different actions: an
 * overdue line needs the supplier chased, a part-received one needs a balance
 * followed up, and one not yet due needs only watching.
 */
export function PendingPos({ lines }: { lines: PendingLine[] }) {
  const counts = useMemo(
    () => ({
      overdue: lines.filter((l) => l.overdue).length,
      part: lines.filter((l) => !l.nothingReceived).length,
      none: lines.filter((l) => l.nothingReceived).length,
      all: lines.length,
    }),
    [lines]
  );

  // Open on a group that has rows: a heading saying two are open above an empty
  // table reads as a bug rather than as good news.
  const [group, setGroup] = useState<"overdue" | "part" | "none" | "all">(() =>
    counts.overdue > 0
      ? "overdue"
      : counts.part > 0
        ? "part"
        : counts.none > 0
          ? "none"
          : "all"
  );
  const [query, setQuery] = useState("");
  const [buyer, setBuyer] = useState("");

  const buyers = useMemo(
    () => [...new Set(lines.map((l) => l.buyer).filter(Boolean))].sort() as string[],
    [lines]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (group === "overdue" && !l.overdue) return false;
      if (group === "part" && l.nothingReceived) return false;
      if (group === "none" && !l.nothingReceived) return false;
      if (buyer && l.buyer !== buyer) return false;
      if (!q) return true;
      // Searched across everything printed on the row, so whatever the user is
      // holding — a PO number, an item code, a supplier name — finds it.
      return [
        l.itemCode,
        l.name,
        l.poNumber,
        l.supplier,
        l.buyer,
        l.lot,
        l.styleRef,
        l.site,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [lines, group, buyer, query]);

  const outstandingShown = shown.reduce((s, l) => s + l.outstanding, 0);

  if (lines.length === 0)
    return (
      <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
        Every purchase order has been fully received.
      </p>
    );

  const tabs: [typeof group, string, number][] = [
    ["overdue", "Overdue", counts.overdue],
    ["part", "Part received", counts.part],
    ["none", "Nothing received", counts.none],
    ["all", "All open", counts.all],
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          {tabs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setGroup(key)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                group === key
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {label} ({n})
            </button>
          ))}
        </div>
        <DownloadButton
          path="/exports/pending-pos.xlsx"
          filename="pending-pos.xlsx"
          label="Download register"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item, code, PO number, supplier…"
          className="min-w-[18rem] flex-1 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-neutral-950"
        />
        <select
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
          className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-neutral-950"
        >
          <option value="">All buyers</option>
          {buyers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">
          {shown.length} line(s) ·{" "}
          <strong className="tabular-nums text-rose-700 dark:text-rose-400">
            {outstandingShown.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </strong>{" "}
          outstanding
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Lot</th>
              <th className="px-4 py-3 font-medium">PO number</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Buyer</th>
              <th className="px-4 py-3 font-medium">ETD</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Received</th>
              <th className="px-4 py-3 text-right font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr
                key={l.id}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{l.name ?? l.itemCode}</div>
                  <div className="text-xs text-neutral-500">
                    <span className="font-mono">{l.itemCode}</span>
                    {l.styleRef ? ` · ${l.styleRef}` : ""}
                    {l.site ? ` · ${shortSite(l.site)}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-500">{l.lot ?? "—"}</td>
                <td className="px-4 py-3">
                  {l.poNumber ? (
                    <span className="font-mono text-xs font-semibold">
                      {l.poNumber}
                    </span>
                  ) : (
                    /* Without it no receipt can ever match this order. */
                    <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      no PO number
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{l.supplier ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                  {l.buyer ?? "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                  {l.etd ?? <span className="text-neutral-400">no ETD</span>}
                </td>
                <td className="px-4 py-3">
                  {l.overdue ? (
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                        l.daysOverdue >= 14
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      }`}
                    >
                      {l.daysOverdue}d late
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {l.etd ? "not due yet" : "no date"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.ordered.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.received.toLocaleString()}
                  {l.ordered > 0 && (
                    <span className="ml-1 text-xs text-neutral-400">
                      {Math.round((l.received / l.ordered) * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                  {l.outstanding.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-sm text-neutral-500"
                >
                  {query || buyer
                    ? "Nothing matches that search."
                    : "Nothing in this group."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
