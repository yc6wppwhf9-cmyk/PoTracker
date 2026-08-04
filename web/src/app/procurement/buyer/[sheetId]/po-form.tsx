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

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-3 py-3 font-medium"></th>
              <th className="px-3 py-3 font-medium">Item</th>
              <th className="px-3 py-3 font-medium">Plant</th>
              <th className="px-3 py-3 font-medium">Lot</th>
              <th className="px-3 py-3 font-medium">Category</th>
              <th className="px-3 py-3 font-medium">Required</th>
              <th className="px-3 py-3 font-medium">Order qty</th>
              <th className="px-3 py-3 font-medium">MOQ</th>
              <th className="px-3 py-3 font-medium">Supplier</th>
              <th className="px-3 py-3 font-medium">Rate</th>
              <th className="px-3 py-3 font-medium">Value</th>
              <th className="px-3 py-3 font-medium">Purchase remark</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const k = keyOf(it);
              const row = rows[k];
              return (
                <tr
                  key={k}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => set(k, "include", e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.name}</div>
                    <div className="font-mono text-xs text-neutral-500">
                      {it.item_code}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-600 dark:text-neutral-300">
                    {it.location ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-600 dark:text-neutral-300">
                    {it.lot ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{it.category}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {it.required_qty.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
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
                  <td className="px-3 py-2">
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
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.supplier}
                      onChange={(e) => set(k, "supplier", e.target.value)}
                      disabled={!row.include}
                      placeholder="supplier name"
                      className="w-40 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
                    />
                  </td>
                  <td className="px-3 py-2">
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
                  <td className="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {row.include && row.rate !== ""
                      ? (
                          (Number(row.rate) || 0) * (Number(row.ordered) || 0)
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
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
