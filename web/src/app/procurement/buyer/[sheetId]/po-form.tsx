"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPo, type CreatePoState } from "../actions";
import { SITES } from "@/lib/sites";

export type AssignedItem = {
  item_code: string;
  lot: string | null;
  location: string | null;
  name: string;
  category: string;
  required_qty: number;
};

const initial: CreatePoState = { error: null, poId: null };

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

  const [allocs, setAllocs] = useState<Alloc[]>(() =>
    items.map((it) => ({
      id: newId(),
      itemKey: keyOf(it),
      include: false,
      ordered: it.required_qty,
      supplier: "",
      rate: "",
      remark: "",
    }))
  );

  // Set once for the whole order: a PO goes to one supplier for one delivery,
  // and drafts are already split per supplier, so repeating these down every
  // row would be the same value typed many times.
  const [etd, setEtd] = useState("");
  const [site, setSite] = useState("");

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
      const s = a.supplier.trim();
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()];
  })();
  const missingSupplier = supplierGroups.find(([s]) => s === "")?.[1] ?? 0;

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
      const remaining = Math.max(0, it.required_qty - taken);
      const next: Alloc = {
        id: newId(),
        itemKey,
        include: true,
        ordered: remaining || 0,
        supplier: "",
        rate: "",
        remark: "",
      };
      const lastIdx = prev.map((a) => a.itemKey).lastIndexOf(itemKey);
      return [...prev.slice(0, lastIdx + 1), next, ...prev.slice(lastIdx + 1)];
    });
  }

  function removeAlloc(id: string) {
    setAllocs((prev) => prev.filter((a) => a.id !== id));
  }

  const thBase =
    "sticky top-0 z-20 whitespace-nowrap border-b border-black/10 bg-white px-3 py-2 font-medium dark:border-white/10 dark:bg-neutral-900";
  const tdBase = "border-b border-black/5 px-3 py-1.5 dark:border-white/5";
  const inputBase =
    "rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950";

  return (
    <>
      <form action={formAction} id="po-form">
        <input type="hidden" name="sheet_id" value={sheetId} />
        <input type="hidden" name="lines" value={JSON.stringify(payload)} />
        <input type="hidden" name="etd" value={etd} />
        <input type="hidden" name="site" value={site} />

        {/* The row is wider than most screens, so the two columns that say
            WHICH material this is are pinned; scrolled right without them a
            buyer types supplier and rate against a line they cannot identify. */}
        <div className="max-h-[70vh] overflow-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className={`${thBase} sticky left-0 z-30`}></th>
                <th className={`${thBase} sticky left-10 z-30 border-r`}>Item</th>
                {["Lot", "Category", "Required", "Order qty", "Supplier",
                  "Rate", "Value", "Purchase remark", ""].map((h, i) => (
                  <th key={h || `blank${i}`} className={thBase}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const k = keyOf(it);
                const group = byItem.get(k) ?? [];
                const allocated = allocatedFor(k);
                const anyIncluded = group.some((a) => a.include);
                const over = anyIncluded && allocated > it.required_qty;
                const under = anyIncluded && allocated < it.required_qty;

                return group.map((a, idx) => {
                  const first = idx === 0;
                  const pinBg = a.include
                    ? "bg-indigo-50 dark:bg-indigo-950/40"
                    : "bg-white dark:bg-neutral-900";
                  return (
                    <tr
                      key={a.id}
                      className={
                        a.include
                          ? "bg-indigo-50/60 dark:bg-indigo-950/20"
                          : "odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                      }
                    >
                      {/* Pinned cells need their own background, or the
                          scrolling columns show through them. */}
                      <td className={`${tdBase} sticky left-0 z-10 w-10 ${pinBg}`}>
                        <input
                          type="checkbox"
                          checked={a.include}
                          onChange={(e) => set(a.id, "include", e.target.checked)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className={`${tdBase} sticky left-10 z-10 border-r ${pinBg}`}>
                        {first ? (
                          <>
                            <div
                              className="max-w-[240px] truncate font-medium"
                              title={it.name}
                            >
                              {it.name}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-neutral-500">
                              <span className="font-mono">{it.item_code}</span>
                              <button
                                type="button"
                                onClick={() => splitRow(k)}
                                title="Buy this line from more than one supplier"
                                className="rounded border border-indigo-200 px-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                              >
                                + split
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="pl-3 text-xs text-neutral-500">
                            ↳ same line, another supplier
                          </div>
                        )}
                      </td>
                      <td className={`${tdBase} whitespace-nowrap font-medium text-neutral-600 dark:text-neutral-300`}>
                        {first ? (it.lot ?? "—") : ""}
                      </td>
                      <td className={`${tdBase} whitespace-nowrap text-neutral-500`}>
                        {first ? it.category : ""}
                      </td>
                      <td className={`${tdBase} whitespace-nowrap text-right tabular-nums text-neutral-500`}>
                        {first ? it.required_qty.toLocaleString() : ""}
                        {first && group.length > 1 && anyIncluded && (
                          <div
                            className={`text-[11px] ${
                              over || under
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-green-700 dark:text-green-400"
                            }`}
                          >
                            {allocated.toLocaleString()} allocated
                          </div>
                        )}
                      </td>
                      <td className={tdBase}>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={a.ordered}
                          onChange={(e) => set(a.id, "ordered", e.target.value)}
                          disabled={!a.include}
                          className={`w-28 ${inputBase}`}
                        />
                      </td>
                      <td className={tdBase}>
                        <input
                          type="text"
                          value={a.supplier}
                          onChange={(e) => set(a.id, "supplier", e.target.value)}
                          disabled={!a.include}
                          placeholder="supplier name"
                          className={`w-40 ${inputBase}`}
                        />
                      </td>
                      <td className={tdBase}>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={a.rate}
                          onChange={(e) => set(a.id, "rate", e.target.value)}
                          disabled={!a.include}
                          placeholder="per unit"
                          className={`w-24 ${inputBase}`}
                        />
                      </td>
                      <td className={`${tdBase} whitespace-nowrap text-right tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {a.include && a.rate !== ""
                          ? ((Number(a.rate) || 0) * (Number(a.ordered) || 0)).toLocaleString(
                              undefined,
                              { maximumFractionDigits: 2 }
                            )
                          : "—"}
                      </td>
                      <td className={tdBase}>
                        <input
                          type="text"
                          value={a.remark}
                          onChange={(e) => set(a.id, "remark", e.target.value)}
                          disabled={!a.include}
                          placeholder="note"
                          className={`w-40 ${inputBase}`}
                        />
                      </td>
                      <td className={tdBase}>
                        {!first && (
                          <button
                            type="button"
                            onClick={() => removeAlloc(a.id)}
                            title="Remove this split"
                            className="rounded px-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </form>

      {/* Order-level fields. Outside the table because they apply to the whole
          PO, not to any one line. */}
      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-neutral-900">
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          <span className="mb-1 block uppercase tracking-wide text-neutral-500">
            ETD
          </span>
          <input
            type="date"
            form="po-form"
            value={etd}
            onChange={(e) => setEtd(e.target.value)}
            className={inputBase}
          />
        </label>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          <span className="mb-1 block uppercase tracking-wide text-neutral-500">
            Delivery site
          </span>
          <select
            form="po-form"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className={`w-56 ${inputBase}`}
          >
            <option value="">— select a site —</option>
            {SITES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-neutral-500">
          Applied to every draft created now. You can change them on a draft
          before sending it.
        </p>
      </div>

      {supplierGroups.length > 1 && (
        <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
          <strong>{supplierGroups.length} separate PO drafts</strong> will be
          created, one per supplier — each gets its own document from the PO
          team:{" "}
          {supplierGroups
            .map(([s, n]) => `${s || "no supplier yet"} (${n})`)
            .join(", ")}
          .
        </p>
      )}
      {missingSupplier > 0 && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {missingSupplier} selected line(s) have no supplier. They will be
          grouped into one draft — set the supplier to split them out.
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
