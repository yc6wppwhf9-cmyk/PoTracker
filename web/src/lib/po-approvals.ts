import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * Purchase orders for the approver to decide on, with what has arrived.
 *
 * "How much came?" is the approver's first question, so received quantity is
 * carried on the line rather than left for them to find in the GRN register.
 */

export type PoApprovalItem = {
  itemCode: string | null;
  name: string | null;
  lot: string | null;
  ordered: number;
  received: number;
  rate: number | null;
  value: number | null;
  etd: string | null;
  site: string | null;
};

export type PoApproval = {
  id: string;
  poNumber: string | null;
  supplier: string | null;
  site: string | null;
  etd: string | null;
  status: string;
  approvalStatus: string;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  buyer: string | null;
  sheetId: string;
  styleRef: string | null;
  hasDoc: boolean;
  ordered: number;
  received: number;
  value: number | null;
  /** open | md_escalated, when an escalation against this PO is unresolved. */
  escalation: string | null;
  items: PoApprovalItem[];
};

/** Receipts match a PO line on number and item, never lot — the RM sheet and
 *  the GRN register name lots from different systems. */
const keyOf = (po: string | null, code: string | null) =>
  `${(po ?? "").toUpperCase()}__${(code ?? "").toUpperCase()}`;

export async function getPoApprovals(): Promise<PoApproval[]> {
  const supabase = await createClient();

  // Drafts are excluded: the buyer has not sent them, so there is no order to
  // approve yet.
  const { data: pos } = await supabase
    .from("po")
    .select(
      "id, po_number, site, etd, status, doc_path, approval_status, approved_at, approved_by, approval_note, created_by, rm_sheet_id, rm_sheet(style_ref), po_line(item_code, lot, ordered_qty, rate, supplier, etd, site, item_master(name))"
    )
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  const rows = pos ?? [];
  if (rows.length === 0) return [];

  const userIds = [
    ...new Set(
      rows.flatMap((p) => [p.created_by, p.approved_by]).filter(Boolean)
    ),
  ] as string[];
  const { data: profs } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map(
    (profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id.slice(0, 8)])
  );

  const poNumbers = rows
    .map((p) => p.po_number)
    .filter((n): n is string => Boolean(n));

  // Paged: a truncated read would understate what arrived, and the approver
  // would sign off an order believing less had been delivered than has.
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
    const k = keyOf(g.po_number, g.item_code);
    receivedBy.set(k, (receivedBy.get(k) ?? 0) + (Number(g.qty) || 0));
  }

  // Unresolved escalations, so an escalated PO is not silently approvable as
  // though nothing had been questioned.
  const { data: escalations } = await supabase
    .from("escalation")
    .select("po_id, status")
    .not("po_id", "is", null)
    .neq("status", "resolved");
  const escalationByPo = new Map(
    (escalations ?? []).map((e) => [e.po_id as string, e.status as string])
  );

  return rows.map((p) => {
    const poLines =
      (p.po_line as unknown as {
        item_code: string | null;
        lot: string | null;
        ordered_qty: number;
        rate: number | null;
        supplier: string | null;
        etd: string | null;
        site: string | null;
        item_master: { name?: string } | null;
      }[]) ?? [];

    const sheet = (Array.isArray(p.rm_sheet) ? p.rm_sheet[0] : p.rm_sheet) as
      | { style_ref: string | null }
      | null;

    const items: PoApprovalItem[] = poLines.map((l) => {
      const ordered = Number(l.ordered_qty) || 0;
      const rate = l.rate == null ? null : Number(l.rate);
      return {
        itemCode: l.item_code,
        name: l.item_master?.name ?? null,
        lot: l.lot,
        ordered,
        received: p.po_number
          ? receivedBy.get(keyOf(p.po_number, l.item_code)) ?? 0
          : 0,
        rate,
        value: rate == null ? null : rate * ordered,
        // Falling back to the order's for POs raised before ETD and site
        // moved down onto the line.
        etd: l.etd ?? p.etd ?? null,
        site: l.site ?? p.site ?? null,
      };
    });

    // One value for the order only where the lines agree on one. An order
    // split across two sites has no single site, and showing the first would
    // tell the approver something no line actually promised.
    const single = <T,>(vals: (T | null)[]): T | null => {
      const set = new Set(vals.filter((v) => v != null));
      return set.size === 1 ? ([...set][0] as T) : null;
    };

    const value = items.some((i) => i.value != null)
      ? items.reduce((s, i) => s + (i.value ?? 0), 0)
      : null;

    return {
      id: p.id,
      poNumber: p.po_number,
      supplier:
        [...new Set(poLines.map((l) => l.supplier?.trim()).filter(Boolean))].join(
          ", "
        ) || null,
      site: single(items.map((i) => i.site)),
      etd: single(items.map((i) => i.etd)),
      status: p.status,
      approvalStatus: p.approval_status ?? "pending",
      approvedAt: p.approved_at,
      approvedBy: p.approved_by ? nameById.get(p.approved_by) ?? null : null,
      approvalNote: p.approval_note,
      buyer: p.created_by ? nameById.get(p.created_by) ?? null : null,
      sheetId: p.rm_sheet_id,
      styleRef: sheet?.style_ref ?? null,
      hasDoc: Boolean(p.doc_path),
      ordered: items.reduce((s, i) => s + i.ordered, 0),
      received: items.reduce((s, i) => s + i.received, 0),
      value,
      escalation: escalationByPo.get(p.id) ?? null,
      items,
    };
  });
}
