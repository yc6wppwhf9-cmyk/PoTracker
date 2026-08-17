"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPo, type CreatePoState } from "../actions";
import { SITES, shortSite } from "@/lib/sites";
import { outstanding, type AssignedItem } from "./assigned-item";

export type { AssignedItem };

const initial: CreatePoState = { error: null, poId: null };

// Matches recon-tabs.tsx and consolidated-view.tsx: a buyer holding a whole
// sheet's backlog otherwise gets thousands of rows in the DOM at once.
const PAGE_SIZE = 100;

const keyOf = (it: { item_code: string; lot: string | null; location: string | null }) =>
  `${it.item_code}__${it.lot ?? ""}__${it.location ?? ""}`;

/**
 * One supplier allocation of one requirement line.
 *
 * A lot can be bought from more than one supplier, so the requirement is not
 * one row but a list of allocations against it. Reconciliation sums ordered
 * quantity per (item_code, lot, location), so two allocations of the same lot
 * add up to the same comparison — and because drafts are split per supplier,
 * they become two POs with two documents.
 */
type Alloc = {
  id: string;
  itemKey: string;
  include: boolean;
  ordered: number | string;
  supplier: string;
  rate: string;
  remark: string;
  /** Per item, because a buyer sets a date and a destination per material.
   *  Identical values across items are what group them onto one PO. */
  etd: string;
  site: string;
};

let seq = 0;
const newId = () => `a${++seq}`;

export function PoForm({
  sheetId,
  items,
}: {
  sheetId: string;
  items: AssignedItem[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"select" | "details">("select");
  const [hideDone, setHideDone] = useState(true);
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);

  const [allocs, setAllocs] = useState<Alloc[]>(() =>
    items.map((it) => ({
      id: newId(),
      itemKey: keyOf(it),
      include: false,
      ordered: outstanding(it),
      supplier: "",
      rate: "",
      remark: "",
      etd: "",
      site: "",
    }))
  );

  const [state, formAction, pending] = useActionState(
    async (prev: CreatePoState, fd: FormData) => {
      const res = await createPo(prev, fd);
      if (res.poId) router.refresh();
      return res;
    },
    initial
  );

  const byItem = useMemo(() => {
    const m = new Map<string, Alloc[]>();
    for (const a of allocs) {
      if (!m.has(a.itemKey)) m.set(a.itemKey, []);
      m.get(a.itemKey)!.push(a);
    }
    return m;
  }, [allocs]);

  const itemByKey = useMemo(
    () => new Map(items.map((it) => [keyOf(it), it])),
    [items]
  );

  const selected = allocs.filter((a) => a.include);

  const payload = selected.map((a) => {
    const it = itemByKey.get(a.itemKey)!;
    return {
      item_code: it.item_code,
      lot: it.lot,
      location: it.location,
      ordered_qty: Number(a.ordered) || 0,
      // MOQ is not part of this process; the column stays at its 0 default, so
      // the reconciliation view's expected_max falls back to the requirement.
      moq: 0,
      supplier: a.supplier.trim() || null,
      rate: a.rate === "" ? null : Number(a.rate),
      remark: a.remark.trim() || null,
      etd: a.etd || null,
      site: a.site || null,
    };
  });

  const orderValue = selected.reduce(
    (sum, a) => sum + (Number(a.rate) || 0) * (Number(a.ordered) || 0),
    0
  );

  // Mirrors the grouping createPo performs, so the button says how many drafts
  // will actually appear. Derived directly rather than memoised: `selected` is
  // rebuilt every render, so a memo keyed on it would never hit anyway.
  const supplierGroups = (() => {
    const counts = new Map<string, number>();
    for (const a of selected) {
      // One PO per supplier, delivery date and destination: a PO document
      // carries exactly one of each, so two dates cannot share an order.
      const k = [a.supplier.trim(), a.etd, a.site].join("|");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()];
  })();
  const groupLabel = (key: string) => {
    const [sup, etd, site] = key.split("|");
    return [
      sup || "no supplier yet",
      etd || "no ETD",
      site ? shortSite(site) : "no site",
    ].join(" · ");
  };
  const missingSupplier = selected.filter((a) => !a.supplier.trim()).length;
  const missingWhen = selected.filter((a) => !a.etd || !a.site).length;

  /** Allocated vs required for one requirement, across all its suppliers. */
  function allocatedFor(itemKey: string): number {
    return (byItem.get(itemKey) ?? [])
      .filter((a) => a.include)
      .reduce((s, a) => s + (Number(a.ordered) || 0), 0);
  }

  function set(id: string, field: keyof Alloc, value: unknown) {
    setAllocs((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  }

  /**
   * Selecting is a decision about the material, not about each supplier split.
   * One tick covers every allocation of the line, so splitting a lot never
   * means remembering to tick the halves separately.
   */
  function setIncluded(itemKey: string, include: boolean) {
    setAllocs((prev) =>
      prev.map((a) => (a.itemKey === itemKey ? { ...a, include } : a))
    );
  }

  /** Add another supplier allocation against the same requirement line. */
  function splitRow(itemKey: string) {
    setAllocs((prev) => {
      const siblings = prev.filter((a) => a.itemKey === itemKey);
      const it = itemByKey.get(itemKey)!;
      const taken = siblings
        .filter((a) => a.include)
        .reduce((s, a) => s + (Number(a.ordered) || 0), 0);
      // Default the new allocation to whatever is still unallocated, so the
      // common case — split the remainder to a second supplier — needs no
      // arithmetic from the buyer.
      const remaining = Math.max(0, outstanding(it) - taken);
      const next: Alloc = {
        id: newId(),
        itemKey,
        // Inherits the line's state: a split of a selected line is selected,
        // and splitting an unselected one does not silently select it.
        include: siblings.some((a) => a.include),
        ordered: remaining || 0,
        supplier: "",
        rate: "",
        remark: "",
        // The other half of a lot usually ships to the same place on the same
        // date; only the supplier differs.
        etd: siblings[0]?.etd ?? "",
        site: siblings[0]?.site ?? "",
      };
      const lastIdx = prev.map((a) => a.itemKey).lastIndexOf(itemKey);
      return [...prev.slice(0, lastIdx + 1), next, ...prev.slice(lastIdx + 1)];
    });
  }

  function removeAlloc(id: string) {
    setAllocs((prev) => prev.filter((a) => a.id !== id));
  }

  const inputBase =
    "w-full rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950";

  // A line fully covered by existing POs has nothing left to buy. It is not
  // deleted — the buyer may want to see what a sheet contained, and a line
  // vanishing without explanation is its own confusion — but it is hidden by
  // default so a sheet of thousands shows only the work remaining.
  const done = items.filter((it) => outstanding(it) <= 0).length;

  // Search across the columns that identify a line — name, code, category and
  // lot — so a buyer working a long sheet can jump to one item without
  // scrolling the whole register.
  const q = search.trim().toLowerCase();
  const matchesSearch = (it: AssignedItem) =>
    q === "" ||
    it.name.toLowerCase().includes(q) ||
    it.item_code.toLowerCase().includes(q) ||
    it.category.toLowerCase().includes(q) ||
    (it.lot ?? "").toLowerCase().includes(q);

  const visibleItems = items.filter(
    (it) => (!hideDone || outstanding(it) > 0) && matchesSearch(it)
  );

  // Only a page of visibleItems is rendered — "select all" and the counts
  // above still act on the full filtered set, only the table rows are
  // clamped. Selection state lives on `allocs`, keyed by item, so paging
  // never loses a tick made on another page.
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageItems = visibleItems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Select-all acts on exactly what is on screen — the rows left after the
  // search and hide-done filters — so it never silently ticks a line the buyer
  // cannot see. Ticking every allocation of each visible line, splits included.
  const visibleKeys = visibleItems.map(keyOf);
  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleKeys.every((k) => (byItem.get(k) ?? []).some((a) => a.include));
  function setAllVisibleIncluded(include: boolean) {
    const keyset = new Set(visibleKeys);
    setAllocs((prev) =>
      prev.map((a) => (keyset.has(a.itemKey) ? { ...a, include } : a))
    );
  }

  // Only items with at least one included allocation — the details step works
  // over exactly what step 1 picked, grouped back to one card per item.
  const selectedItems = items.filter((it) => {
    const group = byItem.get(keyOf(it)) ?? [];
    return group.some((a) => a.include);
  });

  return (
    <>
      <form action={formAction} id="po-form">
        <input type="hidden" name="sheet_id" value={sheetId} />
        <input type="hidden" name="lines" value={JSON.stringify(payload)} />

        {/* Two steps rather than one wide table: picking which lines to order
            and filling in each one's supplier/date/site are different kinds of
            work, and doing both in the same horizontally-scrolling row meant a
            buyer lost track of which column they were in on a long sheet.
            Step 1 stays a plain list to tick; step 2 shows only what got
            ticked, as cards that never need to scroll sideways. */}
        <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => setStep("select")}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              step === "select"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            1. Select items ({selected.length ? `${selected.length} picked` : items.length})
          </button>
          <button
            type="button"
            onClick={() => selected.length > 0 && setStep("details")}
            disabled={selected.length === 0}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              step === "details"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            2. Order details ({selected.length})
          </button>
        </div>

        {step === "select" ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="relative">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPageIndex(0);
                  }}
                  placeholder="Search item, code, category or lot…"
                  className="w-72 max-w-full rounded-md border border-black/10 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-white/15 dark:bg-neutral-950"
                />
                <svg
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                  />
                </svg>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => setAllVisibleIncluded(e.target.checked)}
                  disabled={visibleItems.length === 0}
                  className="size-4 accent-indigo-600"
                />
                Select all{visibleItems.length > 0 ? ` (${visibleItems.length})` : ""}
              </label>

              {done > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
                  <input
                    type="checkbox"
                    checked={hideDone}
                    onChange={(e) => {
                      setHideDone(e.target.checked);
                      setPageIndex(0);
                    }}
                    className="size-4 accent-indigo-600"
                  />
                  Hide {done} line(s) already fully ordered
                </label>
              )}

              {q !== "" && (
                <span className="text-xs text-neutral-400">
                  {visibleItems.length} match(es)
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
              <table className="w-full text-sm">
                <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
                  <tr>
                    <th className="w-10 px-3 py-2 font-medium"></th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Lot</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">To buy</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((it) => {
                    const k = keyOf(it);
                    const anyIncluded = (byItem.get(k) ?? []).some((a) => a.include);
                    return (
                      <tr
                        key={k}
                        className={
                          anyIncluded
                            ? "bg-indigo-50/60 dark:bg-indigo-950/20"
                            : "border-b border-black/5 last:border-0 dark:border-white/5"
                        }
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={anyIncluded}
                            onChange={(e) => setIncluded(k, e.target.checked)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="max-w-[320px] truncate font-medium" title={it.name}>
                            {it.name}
                          </div>
                          <span className="font-mono text-xs text-neutral-500">{it.item_code}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                          {it.lot ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                          {it.category}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {outstanding(it).toLocaleString()}
                          {(it.ordered_qty > 0 || it.drafted_qty > 0) && (
                            <div className="text-[11px] font-normal text-neutral-400">
                              of {it.required_qty.toLocaleString()}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-500">
                        {q !== ""
                          ? "No lines match your search."
                          : "No lines left to order on this sheet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
              <span className="tabular-nums">
                {visibleItems.length === 0
                  ? "No lines"
                  : `Showing ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(
                      (page + 1) * PAGE_SIZE,
                      visibleItems.length
                    ).toLocaleString()} of ${visibleItems.length.toLocaleString()}`}
              </span>

              {pageCount > 1 && (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                    disabled={page === 0}
                    className="rounded-md border border-black/10 px-2 py-1 font-medium disabled:opacity-40 hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
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
                    className="rounded-md border border-black/10 px-2 py-1 font-medium disabled:opacity-40 hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
                  >
                    Next
                  </button>
                </span>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => selected.length > 0 && setStep("details")}
                disabled={selected.length === 0}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                Next: fill in order details ({selected.length}) →
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep("select")}
              className="mb-3 text-sm text-neutral-500 hover:underline"
            >
              ← Back to item selection
            </button>

            <div className="space-y-3">
              {selectedItems.map((it) => {
                const k = keyOf(it);
                const group = (byItem.get(k) ?? []).filter((a) => a.include);
                const allocated = allocatedFor(k);
                const left = outstanding(it);
                const over = allocated > left;
                const under = allocated < left;

                return (
                  <div
                    key={k}
                    className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-black/5 pb-3 dark:border-white/5">
                      <div>
                        <div className="font-medium" title={it.name}>
                          {it.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                          <span className="font-mono">{it.item_code}</span>
                          <span>{it.lot ?? "no lot"}</span>
                          <span>{it.category}</span>
                          <span>To buy: {left.toLocaleString()}</span>
                          {group.length > 1 && (
                            <span
                              className={
                                over || under
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-green-700 dark:text-green-400"
                              }
                            >
                              {allocated.toLocaleString()} allocated
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => splitRow(k)}
                          title="Buy this line from more than one supplier"
                          className="rounded border border-indigo-200 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                        >
                          + split
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncluded(k, false)}
                          title="Remove this item from the order"
                          className="rounded px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {group.map((a, idx) => (
                        <div
                          key={a.id}
                          className={
                            group.length > 1
                              ? "grid grid-cols-2 gap-3 rounded-xl border border-black/5 p-3 dark:border-white/5 sm:grid-cols-3 lg:grid-cols-6"
                              : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
                          }
                        >
                          {group.length > 1 && (
                            <div className="col-span-2 -mb-1 flex items-center justify-between sm:col-span-3 lg:col-span-6">
                              <span className="text-xs font-medium text-neutral-500">
                                Split {idx + 1}
                              </span>
                              {idx > 0 && (
                                <button
                                  type="button"
                                  onClick={() => removeAlloc(a.id)}
                                  title="Remove this split"
                                  className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                                >
                                  ✕ remove split
                                </button>
                              )}
                            </div>
                          )}
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">Order qty</span>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={a.ordered}
                              onChange={(e) => set(a.id, "ordered", e.target.value)}
                              className={inputBase}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">Supplier</span>
                            <input
                              type="text"
                              value={a.supplier}
                              onChange={(e) => set(a.id, "supplier", e.target.value)}
                              placeholder="supplier name"
                              className={inputBase}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">ETD</span>
                            <input
                              type="date"
                              value={a.etd}
                              onChange={(e) => set(a.id, "etd", e.target.value)}
                              className={inputBase}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">Delivery site</span>
                            <select
                              value={a.site}
                              onChange={(e) => set(a.id, "site", e.target.value)}
                              className={inputBase}
                              title={a.site || undefined}
                            >
                              <option value="">— site —</option>
                              {SITES.map((sName) => (
                                <option key={sName} value={sName}>
                                  {shortSite(sName)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">Rate</span>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={a.rate}
                              onChange={(e) => set(a.id, "rate", e.target.value)}
                              placeholder="per unit"
                              className={inputBase}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">Remark</span>
                            <input
                              type="text"
                              value={a.remark}
                              onChange={(e) => set(a.id, "remark", e.target.value)}
                              placeholder="note"
                              className={inputBase}
                            />
                          </label>
                          <div className="col-span-2 text-xs text-neutral-500 sm:col-span-3 lg:col-span-6">
                            Value:{" "}
                            <span className="font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                              {a.rate !== ""
                                ? ((Number(a.rate) || 0) * (Number(a.ordered) || 0)).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 2 }
                                  )
                                : "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </form>

      {supplierGroups.length > 1 && (
        <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
          <strong>{supplierGroups.length} separate PO drafts</strong> will be
          created, one per supplier — each gets its own document from the PO
          team:{" "}
          {supplierGroups.map(([k, n]) => `${groupLabel(k)} (${n})`).join("; ")}
          .
        </p>
      )}
      {(missingSupplier > 0 || missingWhen > 0) && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {missingSupplier > 0 && (
            <>
              {missingSupplier} selected line(s) have no supplier — they are
              grouped into one draft until you set it.{" "}
            </>
          )}
          {missingWhen > 0 && (
            <>
              {missingWhen} line(s) still need an ETD and delivery site; both are
              required before the PO can be sent to the PO team.
            </>
          )}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {selected.length} line(s) selected
          {orderValue > 0 && (
            <>
              {" · order value "}
              <span className="font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                {orderValue.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </span>
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
          {state.poId && (
            <span className="text-sm text-green-600">
              {(state.count ?? 1) > 1
                ? `${state.count} PO drafts created ✓`
                : "PO draft created ✓"}
            </span>
          )}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <button
            type="submit"
            form="po-form"
            disabled={pending || selected.length === 0}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending
              ? "Creating…"
              : supplierGroups.length > 1
                ? `Create ${supplierGroups.length} PO drafts`
                : "Create PO draft"}
          </button>
        </div>
      </div>
    </>
  );
}
