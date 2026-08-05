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
  moq: number;
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
          // MOQ is the minimum a supplier accepts, so default the order up to a
          // whole multiple of it — ordering below MOQ produces a PO no supplier
          // will fulfil. Same formula as expected_max in the reconciliation view.
          ordered: it.moq > 0
            ? Math.ceil(it.required_qty / it.moq) * it.moq
            : it.required_qty,
          moq: it.moq,
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

  const selected = useMemo(
    () => items.filter((it) => rows[keyOf(it)]?.include),
    [items, rows]
  );

  const payload = selected.map((it) => ({
    item_code: it.item_code,
    lot: it.lot,
    location: it.location,
    ordered_qty: Number(rows[keyOf(it)].ordered) || 0,
    moq: Number(rows[keyOf(it)].moq) || 0,
    supplier: rows[keyOf(it)].supplier?.trim() || null,
    rate: rows[keyOf(it)].rate === "" ? null : Number(rows[keyOf(it)].rate),
    remark: rows[keyOf(it)].remark?.trim() || null,
  }));

  const orderValue = selected.reduce((sum, it) => {
    const r = rows[keyOf(it)];
    const rate = r.rate === "" ? 0 : Number(r.rate) || 0;
    return sum + rate * (Number(r.ordered) || 0);
  }, 0);

  // MOQ is usually not in the item master — it is supplier-specific, so the
  // buyer types it here. Once they do, the order quantity has to round up to a
  // whole multiple or the supplier rejects the order.
  const belowMoq = selected.filter((it) => {
    const r = rows[keyOf(it)];
    const q = Number(r.ordered) || 0;
    const m = Number(r.moq) || 0;
    return m > 0 && q > 0 && q < m;
  });

  function roundAllToMoq() {
    setRows((prev) => {
      const next = { ...prev };
      for (const it of selected) {
        const k = keyOf(it);
        const q = Number(next[k].ordered) || 0;
        const m = Number(next[k].moq) || 0;
        if (m > 0) next[k] = { ...next[k], ordered: Math.ceil(q / m) * m };
      }
      return next;
    });
  }

  function set(
    k: string,
    field: "include" | "ordered" | "moq" | "supplier" | "rate" | "remark",
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
              {["Plant", "Lot", "Category", "Required", "Order qty", "MOQ",
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
                    <div className="max-w-[220px] truncate font-medium" title={it.name}>
                      {it.name}
                    </div>
                    <div className="font-mono text-xs text-neutral-500">
                      {it.item_code}
                    </div>
                  </td>
                  <td className="whitespace-nowrap border-b border-black/5 px-3 py-1.5 font-medium text-neutral-600 dark:border-white/5 dark:text-neutral-300">
                    {it.location ?? "—"}
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
                      className={`w-28 rounded-md border px-2 py-1 text-sm disabled:opacity-40 dark:bg-neutral-950 ${
                        row.include &&
                        Number(row.moq) > 0 &&
                        Number(row.ordered) > 0 &&
                        Number(row.ordered) < Number(row.moq)
                          ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                          : "border-black/10 bg-white dark:border-white/15"
                      }`}
                    />
                    {row.include &&
                      Number(row.moq) > 0 &&
                      Number(row.ordered) > 0 &&
                      Number(row.ordered) < Number(row.moq) && (
                        <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                          below MOQ →{" "}
                          {(
                            Math.ceil(
                              Number(row.ordered) / Number(row.moq)
                            ) * Number(row.moq)
                          ).toLocaleString()}
                        </div>
                      )}
                  </td>
                  <td className="border-b border-black/5 px-3 py-1.5 dark:border-white/5">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.moq}
                      onChange={(e) => set(k, "moq", e.target.value)}
                      disabled={!row.include}
                      className="w-24 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
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
          {belowMoq.length > 0 && (
            <button
              type="button"
              onClick={roundAllToMoq}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Round {belowMoq.length} line(s) up to MOQ
            </button>
          )}
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
