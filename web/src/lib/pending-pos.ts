import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * Material still outstanding against a purchase order, one row per item.
 *
 * Flat rather than grouped by PO: chasing a supplier is about a specific
 * material, and a PO-level total does not say which item is short. Flattening
 * also makes the list searchable and filterable in one pass, which a nested
 * shape cannot be.
 *
 * Receipt state is derived from the GRN rows on every load rather than stored
 * on the PO. A status column would have to be kept in step with every import
 * and every correction, and would be silently wrong whenever it drifted.
 */

export type PendingLine = {
  id: string;
  poId: string;
  poNumber: string | null;
  supplier: string | null;
  /** The buyer who raised the PO — who owns chasing it. */
  buyer: string | null;
  buyerId: string | null;
  site: string | null;
  etd: string | null;
  daysOverdue: number;
  overdue: boolean;
  sheetId: string;
  styleRef: string | null;
  itemCode: string | null;
  name: string | null;
  lot: string | null;
  ordered: number;
  received: number;
  outstanding: number;
  /** Nothing at all has arrived — a different conversation from a short one. */
  nothingReceived: boolean;
};

/**
 * A receipt is tied to a PO line by PO number and item, not by lot: the RM
 * sheet and the GRN register name lots from different systems, so requiring
 * them to agree meant a receipt never matched its order.
 */
const keyOf = (code: string | null) => (code ?? "").toUpperCase();

/** Received is measured with a small tolerance, so a rounding difference in the
 *  register is not reported as a short delivery. */
const TOLERANCE = 0.005;

/**
 * @param buyerId  Limit to purchase orders this buyer raised. RLS already
 *   hides other buyers' orders from them, but the filter is explicit so the
 *   page cannot depend on a policy staying exactly as it is today.
 */
export async function getPendingPos(buyerId?: string): Promise<PendingLine[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Every PO that reached a supplier, not only the overdue ones: a part
  // delivery against a PO whose date has not passed is still an open balance
  // somebody has to chase eventually.
  const base = supabase
    .from("po")
    .select(
      "id, po_number, etd, site, rm_sheet_id, status, created_by, rm_sheet(style_ref), po_line(item_code, lot, ordered_qty, supplier, etd, site, item_master(name))"
    )
    .neq("status", "draft");

  const { data: pos } = await (buyerId ? base.eq("created_by", buyerId) : base)
    .order("etd", { ascending: true, nullsFirst: false });

  const rows = pos ?? [];
  if (rows.length === 0) return [];

  // created_by references auth.users, which has no foreign key to profiles.
  const buyerIds = [
    ...new Set(rows.map((p) => p.created_by).filter(Boolean)),
  ] as string[];
  const { data: profs } = buyerIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", buyerIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const buyerById = new Map(
    (profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id.slice(0, 8)])
  );

  const poNumbers = rows
    .map((p) => p.po_number)
    .filter((n): n is string => Boolean(n));

  // Paged: a truncated read would understate what arrived and report delivered
  // orders as outstanding.
  const grn = poNumbers.length
    ? await fetchAll<{
        po_number: string | null;
        item_code: string | null;
        qty: number;
      }>((from, to) =>
        supabase
          .from("grn")
          .select("po_number, item_code, qty")
          .in("po_number", poNumbers)
          .order("id")
          .range(from, to)
      )
    : [];

  const receivedBy = new Map<string, number>();
  for (const g of grn) {
    const k = `${g.po_number}::${keyOf(g.item_code)}`;
    receivedBy.set(k, (receivedBy.get(k) ?? 0) + (Number(g.qty) || 0));
  }

  const out: PendingLine[] = [];
  for (const p of rows) {
    const poLines =
      (p.po_line as unknown as {
        item_code: string | null;
        lot: string | null;
        ordered_qty: number;
        supplier: string | null;
        etd: string | null;
        site: string | null;
        item_master: { name?: string } | null;
      }[]) ?? [];

    const sheet = (Array.isArray(p.rm_sheet) ? p.rm_sheet[0] : p.rm_sheet) as
      | { style_ref: string | null }
      | null;

    poLines.forEach((l, i) => {
      const ordered = Number(l.ordered_qty) || 0;
      if (ordered <= 0) return;

      // The line's own date and site, falling back to the order's for POs
      // raised before they moved down to the line. Chasing is per item — half
      // an order can be overdue while the rest is not yet due.
      const etd = (l.etd ? String(l.etd) : null) ?? (p.etd ? String(p.etd) : null);
      const site = l.site ?? p.site;
      const daysOverdue = etd
        ? Math.max(
            0,
            Math.floor((Date.parse(today) - Date.parse(etd)) / 86_400_000)
          )
        : 0;

      const received = p.po_number
        ? receivedBy.get(`${p.po_number}::${keyOf(l.item_code)}`) ?? 0
        : 0;

      // Complete within tolerance is not outstanding, whatever the rounding in
      // the register says.
      if (received >= ordered * (1 - TOLERANCE)) return;

      out.push({
        id: `${p.id}-${l.item_code ?? ""}-${i}`,
        poId: p.id,
        poNumber: p.po_number,
        supplier: l.supplier,
        buyer: p.created_by ? buyerById.get(p.created_by) ?? null : null,
        buyerId: p.created_by ?? null,
        site,
        etd,
        daysOverdue,
        overdue: Boolean(etd && etd < today),
        sheetId: p.rm_sheet_id,
        styleRef: sheet?.style_ref ?? null,
        itemCode: l.item_code,
        name: l.item_master?.name ?? null,
        lot: l.lot,
        ordered,
        received,
        outstanding: ordered - received,
        nothingReceived: received === 0,
      });
    });
  }

  // Most overdue first, then the nearest upcoming date, then the largest
  // balance — the order they need chasing in.
  return out.sort(
    (a, b) =>
      b.daysOverdue - a.daysOverdue ||
      (a.etd ?? "9999").localeCompare(b.etd ?? "9999") ||
      b.outstanding - a.outstanding
  );
}
