import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getOverReceipts } from "@/lib/over-receipts";
import { getPendingPos } from "@/lib/pending-pos";

/**
 * Headline numbers for the GRN dashboard.
 *
 * The GRN register, the over-receipt list and the pending-PO list each answer
 * one question on their own screen. This gathers the top of each into a single
 * set of tiles, so the roles who oversee purchasing (admin, approver, MD) can
 * read the state of goods receipt at a glance without opening three registers.
 *
 * Every underlying read is paged, so the totals stay correct past the 1,000-row
 * REST cap rather than silently understating a busy register.
 */

export type GrnKpis = {
  /** Total receipt lines in the register. */
  receipts: number;
  /** Distinct purchase orders anything has been received against. */
  posReceived: number;
  /** Receipt lines with a GRC date within the last 7 days. */
  receivedLast7: number;
  /** Sum of received quantity across every line. */
  qtyReceived: number;
  /** Sum of landed cost, where the register carries one. */
  valueReceived: number;
  /** Lines delivered beyond the PO quantity (past tolerance). */
  overLines: number;
  /** What that excess is worth, where a rate is known. */
  overExcessValue: number;
  /** PO lines still short of their ordered quantity. */
  outstandingLines: number;
  /** Outstanding lines already past their ETD. */
  overdueLines: number;
  /** Outstanding lines with nothing received at all. */
  nothingReceivedLines: number;
};

export async function getGrnKpis(): Promise<GrnKpis> {
  const supabase = await createClient();

  // Whole register, paged: distinct POs, the 7-day window and the running
  // totals all need every row, not the first thousand.
  const grn = await fetchAll<{
    po_number: string | null;
    grc_date: string | null;
    qty: number;
    landed_cost: number | null;
  }>((from, to) =>
    supabase
      .from("grn_ours")
      .select("po_number, grc_date, qty, landed_cost")
      .order("id")
      .range(from, to)
  );

  // Rolling 7-day window inclusive of today: today − 6 spans exactly 7 calendar
  // days. today − 7 with a >= test would have counted 8.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const pos = new Set<string>();
  let qtyReceived = 0;
  let valueReceived = 0;
  let receivedLast7 = 0;
  for (const g of grn) {
    if (g.po_number) pos.add(g.po_number.toUpperCase());
    qtyReceived += Number(g.qty) || 0;
    valueReceived += Number(g.landed_cost) || 0;
    if (g.grc_date && g.grc_date >= cutoff) receivedLast7 += 1;
  }

  // Reuse the two registers so their tiles can never disagree with the lists
  // the same roles open next.
  const [over, pending] = await Promise.all([
    getOverReceipts(),
    getPendingPos(),
  ]);

  return {
    receipts: grn.length,
    posReceived: pos.size,
    receivedLast7,
    qtyReceived,
    valueReceived,
    overLines: over.length,
    overExcessValue: over.reduce((t, l) => t + (l.excessValue ?? 0), 0),
    outstandingLines: pending.length,
    overdueLines: pending.filter((l) => l.overdue).length,
    nothingReceivedLines: pending.filter((l) => l.nothingReceived).length,
  };
}
