"use client";

import { useActionState, useState, useMemo } from "react";
import {
  saveAssignments,
  notifyBuyersAction,
  type AssignState,
  type NotifyBuyersState,
} from "../actions";

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
const initialNotify: NotifyBuyersState = { error: null, ok: false, sent: 0 };

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
  const [notifyState, notifyFormAction, notifying] = useActionState(
    notifyBuyersAction,
    initialNotify
  );

  // The two selections above are seeded from props, and a useState initialiser
  // runs only on mount — so once the server data changed after a save, the
  // dropdowns kept showing whatever was there when the page first loaded.
  // Assigning in one view and switching to the other showed "unassigned"
  // despite the rows being saved.
  //
  // Re-seed whenever the server's own values change. Comparing the serialised
  // pairs rather than the array identity matters: a Server Component re-render
  // hands over a new array every time, which would otherwise clobber edits in
  // progress on every refresh.
  const serverCategory = useMemo(
    () => JSON.stringify(groups.map((g) => [g.key, g.currentBuyerId ?? ""])),
    [groups]
  );
  const serverInv = useMemo(
    () =>
      JSON.stringify(invGroups.map((g) => [g.itemCode, g.currentBuyerId ?? ""])),
    [invGroups]
  );

  // Adjusted during render rather than in an effect — React's documented way to
  // reset state when a prop changes. An effect would render once with the stale
  // dropdowns, then again with the fresh ones, which is the visible flicker
  // this bug produced in the first place.
  const [seenCategory, setSeenCategory] = useState(serverCategory);
  if (seenCategory !== serverCategory) {
    setSeenCategory(serverCategory);
    setCategorySelection(
      Object.fromEntries(JSON.parse(serverCategory) as [string, string][])
    );
  }

  const [seenInv, setSeenInv] = useState(serverInv);
  if (seenInv !== serverInv) {
    setSeenInv(serverInv);
    setInvSelection(
      Object.fromEntries(JSON.parse(serverInv) as [string, string][])
    );
  }

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

  // A mixed group counts as assigned — its lines already have buyers, just not
  // a single one — so the tally doesn't read it as outstanding work.
  const assignedCatCount = groups.filter(
    (g) => !g.unmatched && (categorySelection[g.key] || g.mixed)
  ).length;
  const totalAssignableCat = groups.filter((g) => !g.unmatched).length;

  const assignedInvCount = invGroups.filter(
    (g) => invSelection[g.itemCode] || g.mixed
  ).length;

  const payloadAssignments = useMemo(() => {
    if (viewMode === "category") {
      // A mixed category is split across buyers — no single buyer owns it, so
      // its dropdown initialises blank. Sending a blank buyerId tells the RPC
      // to unassign every line in the category, which would wipe that split
      // (this is exactly how a per-item Runner split got lost). Only send a
      // mixed category once someone deliberately picks a buyer for the whole
      // of it; leave it out otherwise so its per-item assignments stand.
      return groups
        .filter((g) => !(g.mixed && (categorySelection[g.key] ?? "") === ""))
        .map((g) => ({ category: g.key, buyerId: categorySelection[g.key] ?? "" }));
    } else {
      // Same guard for the INV view: an item code split across buyers stays
      // untouched until one is chosen for it.
      return invGroups
        .filter((g) => !(g.mixed && (invSelection[g.itemCode] ?? "") === ""))
        .map((g) => ({ itemCode: g.itemCode, buyerId: invSelection[g.itemCode] ?? "" }));
    }
  }, [viewMode, groups, categorySelection, invGroups, invSelection]);

  // Mixed groups count here too, or the "Send to buyers" button stays disabled
  // on a sheet whose only routed category is a per-item split — the tally would
  // read "assigned" while the notify action refused to run. notifyBuyersAction
  // reads the persisted per-line assignments, so those buyers are mailable.
  const savedAssignedCount = groups.filter(
    (g) => !g.unmatched && (g.currentBuyerId || g.mixed)
  ).length;

  return (
    <>
    <form action={formAction} id="assign-form">
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
                        {g.unmatched
                          ? "— (resolve code first)"
                          : g.mixed
                            ? "— keep split (per item) —"
                            : "— unassigned —"}
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
                      <option value="">
                        {g.mixed ? "— keep split (per item) —" : "— unassigned —"}
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
              {filteredInvGroups.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No INV item codes found matching &quot;{searchQuery}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

    </form>

    {/* Action Footer. Outside the form so the notify button can be its own
        form — nesting forms is invalid HTML. The save button reaches back in
        via form="assign-form". */}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-neutral-500">
        {viewMode === "category"
          ? `${assignedCatCount} / ${totalAssignableCat} categories assigned`
          : `${assignedInvCount} / ${invGroups.length} INV item codes assigned`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {state.ok && (
          <span className="text-sm font-semibold text-green-600">
            Assignments saved ✓ — buyers not notified yet
          </span>
        )}
        {state.error && (
          <span className="text-sm font-semibold text-red-600">{state.error}</span>
        )}
        {notifyState.ok && (
          <span className="text-sm font-semibold text-green-600">
            Buyers notified ✓ ({notifyState.sent} buyer{notifyState.sent === 1 ? "" : "s"})
          </span>
        )}
        {notifyState.error && (
          <span className="text-sm font-semibold text-red-600">
            {notifyState.error}
          </span>
        )}

        <button
          type="submit"
          form="assign-form"
          disabled={pending || notifying}
          className="rounded-xl border border-black/10 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50 cursor-pointer dark:border-white/15 dark:bg-neutral-900 dark:text-slate-100"
        >
          {pending ? "Saving..." : "Save assignments"}
        </button>

        {/* Mail is deliberately a separate, explicit step: the head can save
            partial routing as often as they like without the buyers hearing
            about drafts. */}
        <form action={notifyFormAction}>
          <input type="hidden" name="sheet_id" value={sheetId} />
          <button
            type="submit"
            disabled={notifying || pending || savedAssignedCount === 0}
            title={
              savedAssignedCount === 0
                ? "Save at least one assigned category first"
                : "Email each buyer the items assigned to them"
            }
            className="rounded-xl btn-gradient px-5 py-2.5 text-sm font-semibold disabled:opacity-50 cursor-pointer"
          >
            {notifying ? "Sending..." : "Send to buyers"}
          </button>
        </form>
      </div>
    </div>
    </>
  );
}
