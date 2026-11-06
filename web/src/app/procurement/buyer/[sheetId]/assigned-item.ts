export type AssignedItem = {
  item_code: string;
  lot: string | null;
  location: string | null;
  name: string;
  category: string;
  department: string;
  channel: string;
  required_qty: number;
  /** TOTAL_COMPONENT_QUANTITY (or equivalent) from the source sheet — kept
   *  independently of required_qty, which is whichever of total/pending the
   *  sheet offered. */
  total_qty: number;
  /** Stock on hand at the time the sheet was uploaded. */
  soh: number;
  /** PENDING_COMPONENT_TO_ISSUE (or equivalent) from the source sheet. */
  pending_qty: number;
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
  const left = it.required_qty - (it.ordered_qty ?? 0) - (it.drafted_qty ?? 0);
  // Rounded to the sheet's own precision (3 decimals), so float noise such as
  // 0.0020000001 never reaches the order-quantity field.
  const rounded = Math.round(left * 1000) / 1000;
  // A leftover under OUTSTANDING_TOLERANCE is rounding, not material to buy:
  // a requirement of 929.318 drafted as 929.32 (or the reverse) must count as
  // fully ordered, not stay on the list asking for 0.002 more.
  return rounded < OUTSTANDING_TOLERANCE ? 0 : rounded;
}

/** Smallest remainder still treated as something to order. */
export const OUTSTANDING_TOLERANCE = 0.01;
