import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * GRN receipts, each carrying what it was ordered against.
 *
 * A receipt on its own is not reviewable — "3,085 arrived" is only meaningful
 * beside the order — so the comparison travels with the row rather than being
 * something the reader reconstructs from a second table.
 */

export type ReceiptRow = {
  grcNo: string;
  grcDate: string | null;
  poNumber: string | null;
  itemCode: string | null;
  lot: string | null;
  /** Quantity on this receipt line alone. */
  qty: number;
  /** The PO line quantity, or null when no PO here carries that number+item. */
  ordered: number | null;
  /** Running total across every receipt for the same PO and item. */
  received: number;
  /** received − ordered, once past tolerance. */
  excess: number | null;
  supplier: string | null;
  /** The buyer who raised the PO — who to ask about a short or excess
   *  delivery. Null when the PO number matches nothing here. */
  buyer: string | null;
};

/**
 * Matched on PO number and item, never lot: the RM sheet and the GRN register
 * name lots from different systems ("Lot 3" against "GT STOCK"), so requiring
 * them to agree meant a receipt never matched its order.
 */
const keyOf = (po: string | null, code: string | null) =>
  `${(po ?? "").toUpperCase()}__${(code ?? "").toUpperCase()}`;

/** Deliveries are rarely exact — cloth is cut to roll length, hardware ships in
 *  carton multiples — so only an excess beyond this is worth flagging. */
export const OVER_TOLERANCE = 0.02;

export async function getReceipts(limit = 200): Promise<ReceiptRow[]> {
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from("grn_ours")
    .select("grc_no, grc_date, po_number, item_code, lot, qty, supplier")
    .order("grc_date", { ascending: false })
    .limit(limit);

  const rows = recent ?? [];
  if (rows.length === 0) return [];

  const poNumbers = [
    ...new Set(rows.map((r) => r.po_number).filter(Boolean)),
  ] as string[];

  const orderedBy = new Map<string, number>();
  const receivedBy = new Map<string, number>();
  const buyerByPo = new Map<string, string | null>();

  if (poNumbers.length > 0) {
    const { data: pos } = await supabase
      .from("po")
      .select("po_number, created_by, po_line(item_code, ordered_qty)")
      .in("po_number", poNumbers)
      .neq("status", "draft");

    // Who raised each order, so a delivery that is short or over has a name
    // beside it rather than a PO number to look up.
    const buyerIdByPo = new Map<string, string>();
    for (const p of pos ?? [])
      if (p.po_number && p.created_by)
        buyerIdByPo.set(p.po_number.toUpperCase(), p.created_by);

    const buyerIds = [...new Set(buyerIdByPo.values())];
    const { data: profs } = buyerIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", buyerIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const nameById = new Map(
      (profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id.slice(0, 8)])
    );
    for (const [po, id] of buyerIdByPo)
      buyerByPo.set(po, nameById.get(id) ?? null);

    for (const p of pos ?? [])
      for (const l of (p.po_line as unknown as {
        item_code: string | null;
        ordered_qty: number;
      }[]) ?? []) {
        const k = keyOf(p.po_number, l.item_code);
        orderedBy.set(k, (orderedBy.get(k) ?? 0) + (Number(l.ordered_qty) || 0));
      }

    // Summed from the whole table, not just the rows shown: an earlier
    // delivery counts towards the running total and towards any excess.
    // Paged, or a large register would silently understate both.
    const all = await fetchAll<{
      po_number: string | null;
      item_code: string | null;
      qty: number;
    }>((from, to) =>
      supabase
        .from("grn_ours")
        .select("po_number, item_code, qty")
        .in("po_number", poNumbers)
        .order("id")
        .range(from, to)
    );
    for (const g of all) {
      const k = keyOf(g.po_number, g.item_code);
      receivedBy.set(k, (receivedBy.get(k) ?? 0) + (Number(g.qty) || 0));
    }
  }

  return rows.map((r) => {
    const k = keyOf(r.po_number, r.item_code);
    const ordered = orderedBy.get(k) ?? null;
    const received = receivedBy.get(k) ?? (Number(r.qty) || 0);
    return {
      grcNo: r.grc_no,
      grcDate: r.grc_date,
      poNumber: r.po_number,
      itemCode: r.item_code,
      lot: r.lot,
      qty: Number(r.qty) || 0,
      ordered,
      received,
      excess:
        ordered != null && ordered > 0 && received > ordered * (1 + OVER_TOLERANCE)
          ? received - ordered
          : null,
      supplier: r.supplier,
      buyer: buyerByPo.get((r.po_number ?? "").toUpperCase()) ?? null,
    };
  });
}
