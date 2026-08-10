"use client";

import { useMemo, useState } from "react";
import {
  STATUS_META,
  STATUS_ORDER,
  statusVar,
  type ReconRow,
  type ReconStatus,
} from "@/lib/reconciliation";

/** Rows put in the DOM at once. Large enough that paging is rare on a normal
 *  sheet, small enough that the table stays responsive on a big one. */
const PAGE_SIZE = 100;

function fmt(n: number | null): string {
  if (n == null) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Variance as a share of what was required. */
function variancePct(required: number | null, variance: number): string {
  const req = Number(required ?? 0);
  // An extra_not_in_sheet line has nothing required, so a percentage of it is
  // undefined rather than infinite — show the absence instead of "Infinity%".
  if (!req) return "—";
  const pct = (variance / req) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })}%`;
}

export function ReconTabs({
  rows,
  active: controlledActive,
  onActiveChange,
}: {
  rows: ReconRow[];
  /** Optional. Supply both to let a parent follow the selected KPI — the
   *  approver's escalation panel is shown only for the status being looked
   *  at. Omit both and the tabs manage their own selection as before. */
  active?: ReconStatus;
  onActiveChange?: (s: ReconStatus) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (r.status) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const firstNonEmpty =
    STATUS_ORDER.find((s) => (counts[s] ?? 0) > 0) ?? "on_target";
  const [uncontrolled, setUncontrolled] = useState<ReconStatus>(firstNonEmpty);
  const active = controlledActive ?? uncontrolled;
  const setActive = (s: ReconStatus) => {
    setUncontrolled(s);
    setPageIndex(0);
    onActiveChange?.(s);
  };

  const visible = useMemo(() => {
    return rows.filter((r) => {
      const matchStatus = r.status === active;
      if (!matchStatus) return false;
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const codeMatch = (r.item_code ?? "").toLowerCase().includes(q);
      const nameMatch = (r.name ?? "").toLowerCase().includes(q);
      const catMatch = (r.category ?? "").toLowerCase().includes(q);

      return codeMatch || nameMatch || catMatch;
    });
  }, [rows, active, searchQuery]);

  // Only a page of rows is put in the DOM.
  //
  // This table used to render every row of the selected status. On a real
  // sheet that is well over a thousand rows of ten cells each — some twelve
  // thousand nodes for React to build, hydrate and keep — and it was the
  // largest remaining cost after server rendering moved next to the database.
  // Nothing about latency could touch it: the time was going on the browser's
  // own main thread, which is why the page felt heavy to scroll as well as
  // slow to arrive.
  //
  // The filtering above still runs across every row, so search and the counts
  // on the cards describe the whole sheet, not the page being looked at.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageRows = useMemo(
    () => visible.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [visible, page]
  );

  const meta = STATUS_META[active];

  return (
    <div>
      {/* Interactive KPI Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATUS_ORDER.map((s) => {
          const m = STATUS_META[s];
          const n = counts[s] ?? 0;
          const total = rows.length || 1;
          const on = active === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setActive(s)}
              className={`group relative overflow-hidden rounded-2xl border text-left transition-all p-4 cursor-pointer active:scale-[0.98] ${
                on
                  ? "border-indigo-500 bg-indigo-50/30 shadow-md ring-2 ring-indigo-500/20 dark:bg-indigo-950/30"
                  : "glass-card hover:border-indigo-300 dark:hover:border-indigo-800"
              }`}
            >
              <span
                className="absolute inset-y-0 left-0 w-1.5 transition-all"
                style={{ backgroundColor: statusVar(m.token) }}
              />
              <div className="pl-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {m.label}
                </div>
                <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">
                  {n}
                </div>
                <div className="mt-0.5 text-xs font-medium text-slate-400">
                  {Math.round((n / total) * 100)}% of items
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Tabs & Search Bar Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-800">
        {/* Status Tabs */}
        <div className="flex flex-wrap gap-5">
          {STATUS_ORDER.map((s) => {
            const m = STATUS_META[s];
            const n = counts[s] ?? 0;
            const on = active === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setActive(s)}
                style={on ? { borderColor: statusVar(m.token) } : undefined}
                className={`-mb-3.5 flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-all cursor-pointer ${
                  on
                    ? "border-b-2 font-semibold text-slate-900 dark:text-white"
                    : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusVar(m.token) }}
                />
                {m.label}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                    on
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800"
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input Box */}
        <div className="relative min-w-[260px] flex-1 sm:max-w-xs">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPageIndex(0);
            }}
            placeholder="Search item code, name, category..."
            className="w-full rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2 pl-9 text-xs font-medium text-slate-900 shadow-xs outline-none transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden overflow-x-auto rounded-2xl glass-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-left text-xs font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800/80">
              <th className="px-4 py-3.5">Item Name</th>
              <th className="px-4 py-3.5">Item Code</th>
              <th className="px-4 py-3.5">Plant</th>
              <th className="px-4 py-3.5">Lot</th>
              <th className="px-4 py-3.5">Category</th>
              <th className="px-4 py-3.5 text-right">Required</th>
              <th className="px-4 py-3.5 text-right">Ordered</th>
              {/* Its own column: an unsent draft is a different fact from an
                  order, and reading it as a footnote under Ordered invited it
                  to be added in — which is the mistake the split-out was for. */}
              <th className="px-4 py-3.5 text-right">Pending</th>
              {/* "Difference" rather than "Variance": it is required minus
                  ordered, and the plainer word is the one people use for it.
                  Both are renamed so the pair still reads as one idea. */}
              <th className="px-4 py-3.5 text-right">Difference</th>
              <th className="px-4 py-3.5 text-right">Difference %</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const v = r.variance ?? 0;
              const vColor =
                v > 0
                  ? "var(--st-critical-ink)"
                  : v < 0
                    ? "var(--st-warn-ink)"
                    : undefined;
              return (
                <tr
                  key={`${r.item_code ?? "?"}__${r.lot ?? "—"}__${r.location ?? "—"}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-indigo-50/30 transition-colors dark:border-slate-800/50 dark:hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {r.name ?? r.item_code}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-block rounded-md border border-slate-200/80 bg-slate-100/80 px-2 py-0.5 font-mono text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {r.item_code}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-medium text-slate-600 dark:text-slate-300">
                    {r.location ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 font-medium text-slate-600 dark:text-slate-300">
                    {r.lot ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 capitalize font-medium text-slate-500">
                    {r.category ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                    {fmt(r.required)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {fmt(r.ordered)}
                  </td>
                  {/* An unsent draft is not an order — it commits nobody and
                      costs nothing to abandon — so it is counted separately.
                      Hiding it entirely would leave a buyer re-ordering
                      material they had already allocated. */}
                  <td
                    className="px-4 py-3.5 text-right font-semibold tabular-nums"
                    style={
                      (r.drafted ?? 0) > 0
                        ? { color: "var(--st-pending)" }
                        : { color: "#9ca3af" }
                    }
                    title={
                      (r.drafted ?? 0) > 0
                        ? "Allocated to a PO the buyer has not sent yet"
                        : undefined
                    }
                  >
                    {(r.drafted ?? 0) > 0 ? fmt(r.drafted) : "—"}
                  </td>
                  <td
                    className="px-4 py-3.5 text-right font-semibold tabular-nums"
                    style={vColor ? { color: vColor } : { color: "#9ca3af" }}
                  >
                    {v > 0 ? "+" : ""}
                    {fmt(r.variance)}
                  </td>
                  <td
                    className="px-4 py-3.5 text-right font-semibold tabular-nums"
                    style={vColor ? { color: vColor } : { color: "#9ca3af" }}
                  >
                    {variancePct(r.required, v)}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                  {searchQuery
                    ? `No items matching "${searchQuery}" found under ${meta.label}.`
                    : `No items found for status "${meta.label}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Stated even on a single page: "showing 100 of 1,412" is the
          difference between a filter that found little and a table that is
          simply long, and the count is what the approver is judging. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span className="tabular-nums">
          {visible.length === 0
            ? "No items"
            : `Showing ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(
                (page + 1) * PAGE_SIZE,
                visible.length
              ).toLocaleString()} of ${visible.length.toLocaleString()}`}
        </span>

        {pageCount > 1 && (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              disabled={page === 0}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium disabled:opacity-40 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Previous
            </button>
            <span className="tabular-nums">
              Page {page + 1} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
              disabled={page >= pageCount - 1}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium disabled:opacity-40 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Next
            </button>
          </span>
        )}
      </div>

    </div>
  );
}
