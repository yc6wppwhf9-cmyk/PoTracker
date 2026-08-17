"use client";

import { useMemo, useState } from "react";
import { outstanding, type AssignedItem } from "./assigned-item";

type DeptRow = { key: string; lines: number; required: number; toBuy: number };
type ItemRow = {
  key: string;
  name: string;
  category: string;
  lines: number;
  required: number;
  toBuy: number;
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Same view-toggle pattern as the purchase head's assign screen
 * (assign-form.tsx): one full-width table, a tab per grouping, search on the
 * item view. This is read-only — no buyer dropdown — so a buyer can see what
 * is actually left to buy, grouped either way, before drafting POs.
 */
export function ConsolidatedView({ items }: { items: AssignedItem[] }) {
  const [viewMode, setViewMode] = useState<"department" | "item">("department");
  const [searchQuery, setSearchQuery] = useState("");

  const { deptRows, itemRows } = useMemo(() => {
    const byDept = new Map<string, DeptRow>();
    const byItemCode = new Map<string, ItemRow>();
    for (const it of items) {
      const toBuy = outstanding(it);

      const d = byDept.get(it.department) ?? { key: it.department, lines: 0, required: 0, toBuy: 0 };
      d.lines += 1;
      d.required += it.required_qty;
      d.toBuy += toBuy;
      byDept.set(it.department, d);

      const i = byItemCode.get(it.item_code) ?? {
        key: it.item_code,
        name: it.name,
        category: it.category,
        lines: 0,
        required: 0,
        toBuy: 0,
      };
      i.lines += 1;
      i.required += it.required_qty;
      i.toBuy += toBuy;
      byItemCode.set(it.item_code, i);
    }
    return {
      deptRows: [...byDept.values()].sort((a, b) => b.toBuy - a.toBuy || a.key.localeCompare(b.key)),
      itemRows: [...byItemCode.values()].sort((a, b) => b.toBuy - a.toBuy || a.name.localeCompare(b.name)),
    };
  }, [items]);

  const filteredItemRows = useMemo(() => {
    if (!searchQuery.trim()) return itemRows;
    const q = searchQuery.toLowerCase().trim();
    return itemRows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );
  }, [itemRows, searchQuery]);

  if (items.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => setViewMode("department")}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              viewMode === "department"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            🏭 By department ({deptRows.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("item")}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              viewMode === "item"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            🏷 By item ({itemRows.length})
          </button>
        </div>

        {viewMode === "item" && (
          <div className="relative min-w-[240px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search item code, name, category…"
              className="w-full rounded-xl border border-slate-200 bg-white/80 px-3.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        )}
      </div>

      {viewMode === "department" ? (
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">To buy</th>
              </tr>
            </thead>
            <tbody>
              {deptRows.map((d) => (
                <tr key={d.key} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className="px-4 py-3 font-medium">{d.key}</td>
                  <td className="px-4 py-3 text-neutral-500">{d.lines}</td>
                  <td className="px-4 py-3 text-neutral-500">{fmt(d.required)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    {fmt(d.toBuy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Item code</th>
                <th className="px-4 py-3 font-medium">Item description</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">To buy</th>
              </tr>
            </thead>
            <tbody>
              {filteredItemRows.map((r) => (
                <tr key={r.key} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    {r.key}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
                  <td className="px-4 py-3 font-medium capitalize text-slate-500">{r.category}</td>
                  <td className="px-4 py-3 text-neutral-500">{r.lines}</td>
                  <td className="px-4 py-3 text-neutral-500">{fmt(r.required)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    {fmt(r.toBuy)}
                  </td>
                </tr>
              ))}
              {filteredItemRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No items found matching &quot;{searchQuery}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
