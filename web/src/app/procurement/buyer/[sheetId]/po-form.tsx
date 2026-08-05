"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPo, type CreatePoState } from "../actions";

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

export function PoForm({
  sheetId,
  items,
}: {
  sheetId: string;
  items: AssignedItem[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      items.map((it) => [
        keyOf(it),
        {
          include: false,
          ordered: it.required_qty,
          supplier: "",
          rate: "",
          remark: "",
        },
      ])
    )
  );
  const [state, formAction, pending] = useActionState(
    async (prev: CreatePoState, fd: FormData) => {
      const res = await createPo(prev, fd);
      if (res.poId) router.refresh();
      return res;
    },
    initial
  );

  // The Plant column was dropped as noise — it is the same value on nearly
  // every row. But location is part of the join key (item_code, lot, location),
  // so two rows can differ by nothing else, and without it they would look
  // identical while being separate lines. Show it only where it is the only
  // thing telling rows apart.
  const ambiguous = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items) {
      const k = `${it.item_code}__${it.lot ?? ""}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return seen;
  }, [items]);
  const needsPlant = (it: AssignedItem) =>
    (ambiguous.get(`${it.item_code}__${it.lot ?? ""}`) ?? 0) > 1;

  const selected = useMemo(
    () => items.filter((it) => rows[keyOf(it)]?.include),
    [items, rows]
  );

  const payload = selected.map((it) => ({
    item_code: it.item_code,
    lot: it.lot,
    location: it.location,
    ordered_qty: Number(rows[keyOf(it)].ordered) || 0,
    // MOQ is not part of this process; the column stays at its 0 default, so
    // the reconciliation view's expected_max falls back to the required
    // quantity and nothing is ever flagged as MOQ-forced.
    moq: 0,
    supplier: rows[keyOf(it)].supplier?.trim() || null,
    rate: rows[keyOf(it)].rate === "" ? null : Number(rows[keyOf(it)].rate),
    remark: rows[keyOf(it)].remark?.trim() || null,
  }));

  const orderValue = selected.reduce((sum, it) => {
    const r = rows[keyOf(it)];
    const rate = r.rate === "" ? 0 : Number(r.rate) || 0;
    return sum + rate * (Number(r.ordered) || 0);
  }, 0);


  function set(
    k: string,
    field: "include" | "ordered" | "supplier" | "rate" | "remark",
    value: unknown
  ) {
    setRows((r) => ({ ...r, [k]: { ...r[k], [field]: value } }));
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="sheet_id" value={sheetId} />
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />

      {/* The row is wider than most screens, so the two columns that say WHICH
          material this is — the checkbox and the item — are pinned. Scrolled
          right without them, every row shows only its category, and a buyer is
          typing supplier and rate against a line they cannot identify.
          max-h + sticky header keeps the column names visible down a long
          sheet; without it you lose track of which field you are in. */}
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-black/10 bg-white px-3 py-2 font-medium dark:border-white/10 dark:bg-neutral-900"></th>
              <th className="sticky left-10 top-0 z-30 border-b border-r border-black/10 bg-white px-3 py-2 font-medium dark:border-white/10 dark:bg-neutral-900">
                Item
              </th>
              {["Lot", "Category", "Required", "Order qty",
                "Supplier", "Rate", "Value", "Purchase remark"].map((h) => (
                <th
                  key={h}
                  className="sticky top-0 z-20 whitespace-nowrap border-b border-black/10 bg-white px-3 py-2 font-medium dark:border-white/10 dark:bg-neutral-900"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const k = keyOf(it);
              const row = rows[k];
              return (
                <tr
                  key={k}
                  className={
                    row.include
                      ? "bg-indigo-50/60 dark:bg-indigo-950/20"
                      : "odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                  }
                >
                  {/* Pinned cells need their own background, or the scrolling
                      columns show through them. The row tint is repeated for
                      the same reason. */}
                  <td
                    className={`sticky left-0 z-10 w-10 border-b border-black/5 px-3 py-1.5 dark:border-white/5 ${
                      row.include
                        ? "bg-indigo-50 dark:bg-indigo-950/40"
                        : "bg-white dark:bg-neutral-900"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => set(k, "include", e.target.checked)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td
                    className={`sticky left-10 z-10 border-b border-r border-black/5 px-3 py-1.5 dark:border-white/5 ${
                      row.include
                        ? "bg-indigo-50 dark:bg-indigo-950/40"
                        : "bg-white dark:bg-neutral-900"
                    }`}
                  >
                    <div className="max-w-[240px] truncate font-medium" title={it.name}>
                      {it.name}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="font-mono">{it.item_code}</span>
                      {needsPlant(it) && it.location && (
                        <span
                          className="rounded bg-neutral-100 px-1 py-px text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          title="Same item and lot also appears at another plant"
                        >
                          {it.location}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap border-b border-black/5 px-3 py-1.5 font-medium text-neutral-600 dark:border-white/5 dark:text-neutral-300">
                    {it.lot ?? "—"}
                  </td>
                  <td className="whitespace-nowrap border-b border-black/5 px-3 py-1.5 text-neutral-500 dark:border-white/5">
                    {it.category}
                  </td>
                  <td className="whitespace-nowrap border-b border-black/5 px-3 py-1.5 text-right tabular-nums text-neutral-500 dark:border-white/5">
                    {it.required_qty.toLocaleString()}
                  </td>
                  <td className="border-b border-black/5 px-3 py-1.5 dark:border-white/5">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.ordered}
                      onChange={(e) => set(k, "ordered", e.target.value)}
                      disabled={!row.include}
                      className="w-28 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
                    />
                  </td>
                  <td className="border-b border-black/5 px-3 py-1.5 dark:border-white/5">
                    <input
                      type="text"
                      value={row.supplier}
                      onChange={(e) => set(k, "supplier", e.target.value)}
                      disabled={!row.include}
                      placeholder="supplier name"
                      className="w-40 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
                    />
                  </td>
                  <td className="border-b border-black/5 px-3 py-1.5 dark:border-white/5">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.rate}
                      onChange={(e) => set(k, "rate", e.target.value)}
                      disabled={!row.include}
                      placeholder="per unit"
                      className="w-24 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
                    />
                  </td>
                  <td className="whitespace-nowrap border-b border-black/5 px-3 py-1.5 text-right tabular-nums text-neutral-600 dark:border-white/5 dark:text-neutral-300">
                    {row.include && row.rate !== ""
                      ? (
                          (Number(row.rate) || 0) * (Number(row.ordered) || 0)
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : "—"}
                  </td>
                  <td className="border-b border-black/5 px-3 py-1.5 dark:border-white/5">
                    <input
                      type="text"
                      value={row.remark}
                      onChange={(e) => set(k, "remark", e.target.value)}
                      disabled={!row.include}
                      placeholder="note"
                      className="w-40 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
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
            <span className="text-sm text-green-600">PO draft created ✓</span>
          )}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <button
            type="submit"
            disabled={pending || selected.length === 0}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Creating…" : "Create PO draft"}
          </button>
        </div>
      </div>
    </form>
  );
}
