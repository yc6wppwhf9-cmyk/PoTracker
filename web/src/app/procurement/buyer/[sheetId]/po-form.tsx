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
        { include: false, ordered: it.required_qty, moq: it.moq, remark: "" },
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
    remark: rows[keyOf(it)].remark?.trim() || null,
  }));

  function set(
    k: string,
    field: "include" | "ordered" | "moq" | "remark",
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
                      value={row.remark}
                      onChange={(e) => set(k, "remark", e.target.value)}
                      disabled={!row.include}
                      placeholder="vendor / note"
                      className="w-44 rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-neutral-500">{selected.length} line(s) selected</p>
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
