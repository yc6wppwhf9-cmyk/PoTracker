import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * Purchase orders whose delivery date has passed without the goods fully
 * arriving.
 *
 * Receipt state is derived from the GRN rows rather than stored on the PO. A
 * status column would have to be kept in step with every import and every
 * correction, and would be wrong — silently — whenever it drifted. Deriving it
 * costs one extra query and cannot go stale.
 */

export type PendingLine = {
  itemCode: string | null;
  name: string | null;
  lot: string | null;
  ordered: number;
  received: number;
};

export type PendingPo = {
  id: string;
  poNumber: string | null;
  supplier: string | null;
  site: string | null;
  etd: string;
  daysOverdue: number;
  sheetId: string;
  styleRef: string | null;
  ordered: number;
  received: number;
  /** Nothing at all has arrived — a different conversation from a short delivery. */
  nothingReceived: boolean;
  lines: PendingLine[];
};

const keyOf = (code: string | null, lot: string | null) =>
  `${(code ?? "").toUpperCase()}__${lot ?? ""}`;

/** Received quantity is measured against ordered with a small tolerance, so a
 *  rounding difference in the register is not reported as a short delivery. */
const TOLERANCE = 0.005; // 0.5%

export async function getPendingPos(): Promise<PendingPo[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Only POs that actually reached a supplier can be overdue: a draft was never
  // sent, and one with no ETD has no date to be late against.
  const { data: pos } = await supabase
    .from("po")
    .select(
      "id, po_number, etd, site, rm_sheet_id, status, rm_sheet(style_ref), po_line(item_code, lot, ordered_qty, supplier, item_master(name))"
    )
    .neq("status", "draft")
    .not("etd", "is", null)
    .lt("etd", today)
    .order("etd", { ascending: true });

  const rows = pos ?? [];
  if (rows.length === 0) return [];

  // Receipts for exactly these POs. Paged: a truncated read would understate
  // what has arrived and report delivered orders as pending.
  const poNumbers = rows
    .map((p) => p.po_number)
    .filter((n): n is string => Boolean(n));

  const grn = poNumbers.length
    ? await fetchAll<{
        po_number: string | null;
        item_code: string | null;
        lot: string | null;
        qty: number;
      }>(
        (from, to) =>
          supabase
            .from("grn")
            .select("po_number, item_code, lot, qty")
            .in("po_number", poNumbers)
            .order("id")
            .range(from, to)
      )
    : [];

  // Sum per PO and line: several receipts against one line are one arrival.
  const receivedByPoLine = new Map<string, number>();
  for (const g of grn) {
    const k = `${g.po_number}::${keyOf(g.item_code, g.lot)}`;
    receivedByPoLine.set(k, (receivedByPoLine.get(k) ?? 0) + (Number(g.qty) || 0));
  }

  const out: PendingPo[] = [];
  for (const p of rows) {
    const poLines =
      (p.po_line as unknown as {
        item_code: string | null;
        lot: string | null;
        ordered_qty: number;
        supplier: string | null;
        item_master: { name?: string } | null;
      }[]) ?? [];

    const lines: PendingLine[] = poLines.map((l) => ({
      itemCode: l.item_code,
      name: l.item_master?.name ?? null,
      lot: l.lot,
      ordered: Number(l.ordered_qty) || 0,
      received: p.po_number
        ? receivedByPoLine.get(`${p.po_number}::${keyOf(l.item_code, l.lot)}`) ?? 0
        : 0,
    }));

    const ordered = lines.reduce((s, l) => s + l.ordered, 0);
    const received = lines.reduce((s, l) => s + l.received, 0);

    // Fully received within tolerance is not pending, whatever its status says.
    if (ordered > 0 && received >= ordered * (1 - TOLERANCE)) continue;

    const sheet = (Array.isArray(p.rm_sheet) ? p.rm_sheet[0] : p.rm_sheet) as
      | { style_ref: string | null }
      | null;

    const etd = String(p.etd);
    const daysOverdue = Math.floor(
      (Date.parse(today) - Date.parse(etd)) / 86_400_000
    );

    out.push({
      id: p.id,
      poNumber: p.po_number,
      supplier:
        [...new Set(poLines.map((l) => l.supplier?.trim()).filter(Boolean))].join(", ") ||
        null,
      site: p.site,
      etd,
      daysOverdue,
      sheetId: p.rm_sheet_id,
      styleRef: sheet?.style_ref ?? null,
      ordered,
      received,
      nothingReceived: received === 0,
      lines,
    });
  }

  // Most overdue first — that is the order they need chasing in.
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
