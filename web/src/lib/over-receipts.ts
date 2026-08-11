import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * Material received in excess of what was ordered.
 *
 * The reconciliation view catches ordering more than the sheet required. This
 * catches the case that survives a correct order: the PO matches the
 * requisition, and the supplier delivers more than the PO says. Nothing earlier
 * in the chain can see it, because at PO time the numbers were right.
 *
 * Two excesses are reported, and they answer different questions:
 *
 *   vs ordered   — did the supplier ship more than we asked for? This is the
 *                  invoice argument, and the one to raise with them.
 *   vs required  — is the excess actually surplus stock? An over-delivery
 *                  against a PO that was itself under the requirement is not
 *                  costing anything; it is filling a gap.
 */

export type OverReceiptLine = {
  poId: string;
  poNumber: string | null;
  supplier: string | null;
  site: string | null;
  sheetId: string;
  styleRef: string | null;
  itemCode: string;
  name: string | null;
  lot: string | null;
  ordered: number;
  received: number;
  /** received − ordered, always > 0 here. */
  excess: number;
  /** What the excess is worth at the PO's own rate, when a rate is known. */
  excessValue: number | null;
  /** The sheet's requirement for the same key, across every PO. */
  required: number | null;
  /** received − required. Negative means the excess still fills a shortfall. */
  vsRequired: number | null;
  receipts: { grcNo: string; grcDate: string | null; qty: number }[];
};

/**
 * A receipt is tied to a PO line by PO number and item, not by lot.
 *
 * The two sides name lots from different systems — the RM sheet says "Lot 3",
 * the GRN register says "GT STOCK" or "July LOT/00000023/26-27" — so requiring
 * them to agree meant a receipt never matched its order, and the failure looked
 * like a wrong PO number rather than a vocabulary difference.
 *
 * A PO number already identifies one supplier's order and the barcode
 * identifies the material within it, so the pair is specific enough. Quantities
 * are summed across lots on both sides, which is the same total either way.
 */
const keyOf = (code: string | null) => (code ?? "").toUpperCase();

/**
 * Deliveries are rarely exact — cloth is cut to roll length, hardware ships in
 * carton multiples. Only an excess beyond this is worth anyone's attention;
 * below it, flagging every line would train people to ignore the list.
 */
export const OVER_TOLERANCE = 0.02; // 2%

export async function getOverReceipts(): Promise<OverReceiptLine[]> {
  const supabase = await createClient();

  // Only POs that were actually placed can be over-delivered against.
  // Paged. Supabase caps a single read at 1000 rows and reports no error when
  // it truncates, so past a thousand purchase orders this screen would simply
  // stop showing the rest — quietly, and with every total understated.
  const pos = await fetchAll((from, to) =>
    supabase
      .from("po")
      .select(
        "id, po_number, site, rm_sheet_id, rm_sheet(style_ref), po_line(item_code, lot, location, ordered_qty, rate, supplier, item_master(name))"
      )
      .neq("status", "draft")
      .not("po_number", "is", null)
      .order("id")
      .range(from, to)
  );

  const rows = pos ?? [];
  if (rows.length === 0) return [];

  const poNumbers = rows
    .map((p) => p.po_number)
    .filter((n): n is string => Boolean(n));

  // Paged: a truncated read would understate what arrived and hide the very
  // over-receipts this exists to find.
  const grn = await fetchAll<{
    po_number: string | null;
    item_code: string | null;
    lot: string | null;
    qty: number;
    grc_no: string;
    grc_date: string | null;
  }>((from, to) =>
    supabase
      .from("grn_ours")
      .select("po_number, item_code, lot, qty, grc_no, grc_date")
      .in("po_number", poNumbers)
      .order("id")
      .range(from, to)
  );

  const byPoLine = new Map<
    string,
    { qty: number; receipts: { grcNo: string; grcDate: string | null; qty: number }[] }
  >();
  for (const g of grn) {
    const k = `${g.po_number}::${keyOf(g.item_code)}`;
    const entry = byPoLine.get(k) ?? { qty: 0, receipts: [] };
    entry.qty += Number(g.qty) || 0;
    entry.receipts.push({
      grcNo: g.grc_no,
      grcDate: g.grc_date,
      qty: Number(g.qty) || 0,
    });
    byPoLine.set(k, entry);
  }

  // Sheet requirements, to say whether an excess is genuine surplus.
  const sheetIds = [...new Set(rows.map((p) => p.rm_sheet_id))];
  const reqs = sheetIds.length
    ? await fetchAll<{
        rm_sheet_id: string;
        item_code: string | null;
        lot: string | null;
        required_qty: number;
      }>((from, to) =>
        supabase
          .from("rm_requirement")
          .select("rm_sheet_id, item_code, lot, required_qty")
          .in("rm_sheet_id", sheetIds)
          .not("item_code", "is", null)
          .order("id")
          .range(from, to)
      )
    : [];
  const requiredBy = new Map<string, number>();
  for (const r of reqs) {
    const k = `${r.rm_sheet_id}::${keyOf(r.item_code)}`;
    requiredBy.set(k, (requiredBy.get(k) ?? 0) + (Number(r.required_qty) || 0));
  }

  const out: OverReceiptLine[] = [];
  for (const p of rows) {
    const lines =
      (p.po_line as unknown as {
        item_code: string | null;
        lot: string | null;
        ordered_qty: number;
        rate: number | null;
        supplier: string | null;
        item_master: { name?: string } | null;
      }[]) ?? [];

    const sheet = (Array.isArray(p.rm_sheet) ? p.rm_sheet[0] : p.rm_sheet) as
      | { style_ref: string | null }
      | null;

    for (const l of lines) {
      if (!l.item_code) continue;
      const k = `${p.po_number}::${keyOf(l.item_code)}`;
      const got = byPoLine.get(k);
      if (!got) continue;

      const ordered = Number(l.ordered_qty) || 0;
      const received = got.qty;
      if (ordered <= 0) continue;
      if (received <= ordered * (1 + OVER_TOLERANCE)) continue;

      const excess = received - ordered;
      const rate = l.rate == null ? null : Number(l.rate);
      const required =
        requiredBy.get(`${p.rm_sheet_id}::${keyOf(l.item_code)}`) ?? null;

      out.push({
        poId: p.id,
        poNumber: p.po_number,
        supplier: l.supplier,
        site: p.site,
        sheetId: p.rm_sheet_id,
        styleRef: sheet?.style_ref ?? null,
        itemCode: l.item_code,
        name: l.item_master?.name ?? null,
        lot: l.lot,
        ordered,
        received,
        excess,
        excessValue: rate == null ? null : rate * excess,
        required,
        vsRequired: required == null ? null : received - required,
        receipts: got.receipts.sort((a, b) =>
          (a.grcDate ?? "").localeCompare(b.grcDate ?? "")
        ),
      });
    }
  }

  // Costliest first — that is the order they are worth chasing in. Lines with
  // no rate fall back to the excess quantity so they are not lost at the end.
  return out.sort(
    (a, b) => (b.excessValue ?? b.excess) - (a.excessValue ?? a.excess)
  );
}
