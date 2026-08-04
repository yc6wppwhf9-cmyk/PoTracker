"use client";

import { useActionState, useState, useMemo } from "react";
import { saveAssignments, type AssignState } from "../actions";

export type BuyerOption = { id: string; name: string };

export type CategoryGroup = {
  key: string;
  label: string;
  lines: number;
  items: number;
  totalQty: number;
  currentBuyerId: string | null;
  mixed: boolean;
  needsReview: boolean;
  unmatched: boolean;
};

export type InvItemGroup = {
  itemCode: string;
  name: string;
  category: string;
  lines: number;
  totalQty: number;
  currentBuyerId: string | null;
  mixed: boolean;
};

const initial: AssignState = { error: null, ok: false };

export function AssignForm({
  sheetId,
  groups,
  invGroups,
  buyers,
}: {
  sheetId: string;
  groups: CategoryGroup[];
  invGroups: InvItemGroup[];
  buyers: BuyerOption[];
}) {
  const [viewMode, setViewMode] = useState<"category" | "inv">("category");
  const [searchQuery, setSearchQuery] = useState("");

  const [categorySelection, setCategorySelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.currentBuyerId ?? ""]))
  );

  const [invSelection, setInvSelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(invGroups.map((g) => [g.itemCode, g.currentBuyerId ?? ""]))
  );

  const [state, formAction, pending] = useActionState(saveAssignments, initial);

  const filteredInvGroups = useMemo(() => {
    if (!searchQuery.trim()) return invGroups;
    const q = searchQuery.toLowerCase().trim();
    return invGroups.filter(
      (g) =>
        g.itemCode.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q)
    );
  }, [invGroups, searchQuery]);

  const assignedCatCount = groups.filter((g) => !g.unmatched && categorySelection[g.key]).length;
  const totalAssignableCat = groups.filter((g) => !g.unmatched).length;

  const assignedInvCount = invGroups.filter((g) => invSelection[g.itemCode]).length;

  const payloadAssignments = useMemo(() => {
    if (viewMode === "category") {
      return groups.map((g) => ({ category: g.key, buyerId: categorySelection[g.key] ?? "" }));
    } else {
      return invGroups.map((g) => ({ itemCode: g.itemCode, buyerId: invSelection[g.itemCode] ?? "" }));
    }
  }, [viewMode, groups, categorySelection, invGroups, invSelection]);

  return (
    <form action={formAction}>
      <input type="hidden" name="sheet_id" value={sheetId} />
      <input
        type="hidden"
        name="assignments"
        value={JSON.stringify(payloadAssignments)}
      />

      {/* View Mode Toggle Controls */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => setViewMode("category")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === "category"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            📂 View by Category ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("inv")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === "inv"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            🏷 View by INV Item Code ({invGroups.length})
          </button>
        </div>

        {viewMode === "inv" && (
          <div className="relative min-w-[240px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search INV code, item name, category..."
              className="w-full rounded-xl border border-slate-200 bg-white/80 px-3.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        )}
      </div>

      {/* Category View Table */}
      {viewMode === "category" ? (
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Total qty</th>
                <th className="px-4 py-3 font-medium">Assigned Buyer</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.key}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-medium">
                    {g.label}
                    {g.mixed && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        mixed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{g.items}</td>
                  <td className="px-4 py-3 text-neutral-500">{g.lines}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    {g.totalQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={categorySelection[g.key] ?? ""}
                      onChange={(e) =>
                        setCategorySelection((s) => ({ ...s, [g.key]: e.target.value }))
                      }
                      disabled={pending}
                      className="w-56 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-950"
                    >
                      <option value="">
                        {g.unmatched ? "— (resolve code first)" : "— unassigned —"}
                      </option>
                      {buyers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* INV Item Code View Table */
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">INV Item Code</th>
                <th className="px-4 py-3 font-medium">Item Description</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Total qty</th>
                <th className="px-4 py-3 font-medium">Assigned Buyer</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvGroups.map((g) => (
                <tr
                  key={g.itemCode}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    {g.itemCode}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {g.name}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-500 capitalize">
                    {g.category}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{g.lines}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    {g.totalQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={invSelection[g.itemCode] ?? ""}
                      onChange={(e) =>
                        setInvSelection((s) => ({ ...s, [g.itemCode]: e.target.value }))
                      }
                      disabled={pending}
                      className="w-56 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-950"
                    >
                      <option value="">— unassigned —</option>
                      {buyers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {filteredInvGroups.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No INV item codes found matching "{searchQuery}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Action Footer */}
      <div className="mt-5 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {viewMode === "category"
            ? `${assignedCatCount} / ${totalAssignableCat} categories assigned`
            : `${assignedInvCount} / ${invGroups.length} INV item codes assigned`}
        </p>
        <div className="flex items-center gap-3">
          {state.ok && (
            <span className="text-sm font-semibold text-green-600">Assignments saved ✓</span>
          )}
          {state.error && (
            <span className="text-sm font-semibold text-red-600">{state.error}</span>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl btn-gradient px-5 py-2.5 text-sm font-semibold disabled:opacity-50 cursor-pointer"
          >
            {pending ? "Saving..." : "Save assignments"}
          </button>
        </div>
      </div>
    </form>
  );
}
