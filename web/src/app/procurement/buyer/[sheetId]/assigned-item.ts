export type AssignedItem = {
  item_code: string;
  lot: string | null;
  location: string | null;
  name: string;
  category: string;
  department: string;
  required_qty: number;
  /** Already on a PO that has been sent. */
  ordered_qty: number;
  /** Already on a draft PO, sent or not. Counts against the requirement here
   *  even though reconciliation excludes it: the buyer must not allocate the
   *  same material twice just because they have not pressed send yet. */
  drafted_qty: number;
};

/**
 * What is left to buy on a line.
 *
 * The form used to open with every line pre-filled to its FULL requirement,
 * however much had already been ordered — so a buyer who raised a PO for half
 * a lot, then came back for the rest, was handed the whole quantity again. Two
 * POs for 1,960 against a requirement of 3,920 is exactly what that produced.
 *
 * Plain module, not exported from po-form.tsx: that file is "use client", and
 * every export from a client-component file becomes a client-only reference
 * in the RSC bundle — even a pure function — so the server-rendered sheet
 * page cannot call it directly from there.
 */
export function outstanding(it: AssignedItem): number {
  return Math.max(
    0,
    it.required_qty - (it.ordered_qty ?? 0) - (it.drafted_qty ?? 0)
  );
}
