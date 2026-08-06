"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { notifyBuyerEscalation, notifyMdEscalations } from "@/lib/notify";

export type PoActionState = { error: string | null; ok: boolean };

/** Matches the sheet-level escalation: Mon–Sat 09:00–18:00 IST, after which
 *  the escalation is promoted to the MD. */
const WORKING_HOURS_SLA = 9;

/**
 * Approve a purchase order.
 *
 * The approver is final — the MD sees only what is escalated to them — so this
 * is the decision, not a step towards one. Approving is therefore recorded on
 * the PO itself rather than on the sheet, because a sheet becomes many POs to
 * many suppliers and "the sheet is approved" says nothing about which order was
 * agreed to.
 */
export async function approvePo(
  poId: string,
  note: string | null
): Promise<PoActionState> {
  const me = await requireRole("approver");
  const supabase = await createClient();
  if (!poId) return { error: "Missing PO.", ok: false };

  const { data: poRows, error: readErr } = await supabase
    .from("po")
    .select("id, po_number, status, approval_status, rm_sheet_id")
    .eq("id", poId)
    .limit(1);
  if (readErr) return { error: readErr.message, ok: false };
  const po = poRows?.[0];
  if (!po) return { error: "PO not found.", ok: false };
  if (po.approval_status === "approved")
    return { error: "This PO has already been approved.", ok: false };

  // A draft was never sent to anyone: approving one would sign off an order the
  // supplier has not seen and the buyer may still be editing.
  if (po.status === "draft")
    return {
      error: "This PO is still a draft — the buyer has not sent it yet.",
      ok: false,
    };

  const { data: updated, error } = await supabase
    .from("po")
    .update({
      approval_status: "approved",
      approved_by: me.userId,
      approved_at: new Date().toISOString(),
      approval_note: note?.trim() || null,
    })
    .eq("id", poId)
    .eq("approval_status", "pending")
    .select("id");

  if (error) {
    if (error.message.includes("po_approval_status_check"))
      return {
        error:
          "The database does not yet allow PO approval. Apply " +
          "supabase/migrations/20260813_po_approval.sql, then retry.",
        ok: false,
      };
    // RLS denies an UPDATE by affecting zero rows rather than raising, so a
    // permissionless approval would otherwise look like it worked.
    return { error: error.message, ok: false };
  }
  if ((updated?.length ?? 0) === 0)
    return {
      error:
        "Nothing was approved — either the PO was approved by someone else " +
        "just now, or your role lacks permission. Apply " +
        "supabase/migrations/20260813_po_approval.sql if this persists.",
      ok: false,
    };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "po",
    entity_id: poId,
    action: "po_approved",
    detail: { po_number: po.po_number, note: note?.trim() || null },
  });

  revalidatePath("/procurement/po-approvals");
  revalidatePath("/procurement/pending-pos");
  return { error: null, ok: true };
}

/**
 * Escalate a purchase order to the buyer who raised it.
 *
 * Raised against the PO rather than a reconciliation line: the approver is
 * questioning that order, and the supplier and PO number are the whole content
 * of the message. Unanswered for the SLA, it is promoted to the MD by the same
 * sweep that handles sheet escalations — which is the only thing the MD is
 * asked to look at.
 */
export async function escalatePo(
  poId: string,
  reason: string
): Promise<PoActionState> {
  const me = await requireRole("approver");
  const supabase = await createClient();
  if (!poId) return { error: "Missing PO.", ok: false };
  if (!reason.trim())
    return { error: "Say what the buyer needs to answer.", ok: false };

  const { data: poRows } = await supabase
    .from("po")
    .select("id, po_number, created_by, rm_sheet_id, po_line(item_code, lot)")
    .eq("id", poId)
    .limit(1);
  const po = poRows?.[0];
  if (!po) return { error: "PO not found.", ok: false };
  if (!po.created_by)
    return {
      error: "This PO has no buyer recorded, so there is nobody to escalate to.",
      ok: false,
    };

  // Already open against this PO — a second escalation would mail the buyer
  // again about a question they have not answered yet.
  const { data: existing } = await supabase
    .from("escalation")
    .select("id")
    .eq("po_id", poId)
    .neq("status", "resolved")
    .limit(1);
  if (existing?.length)
    return { error: "This PO is already escalated and unresolved.", ok: false };

  const { data: deadline } = await supabase.rpc("add_working_hours", {
    p_start: new Date().toISOString(),
    p_hours: WORKING_HOURS_SLA,
  });

  const lines =
    (po.po_line as unknown as { item_code: string | null; lot: string | null }[]) ??
    [];

  const { error } = await supabase.from("escalation").insert({
    rm_sheet_id: po.rm_sheet_id,
    po_id: poId,
    // The first item is carried for display in the existing escalation views,
    // which are item-oriented; the PO is what the escalation is really about.
    item_code: lines[0]?.item_code ?? null,
    lot: lines[0]?.lot ?? null,
    raised_by: me.userId,
    assigned_buyer: po.created_by,
    reason: reason.trim(),
    status: "open",
    escalate_after: deadline as unknown as string,
  });
  if (error) {
    if (error.message.includes("po_id"))
      return {
        error:
          "The database does not yet track PO escalations. Apply " +
          "supabase/migrations/20260813_po_approval.sql, then retry.",
        ok: false,
      };
    return { error: error.message, ok: false };
  }

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "po",
    entity_id: poId,
    action: "po_escalated",
    detail: { po_number: po.po_number, buyer: po.created_by, reason: reason.trim() },
  });

  // Non-fatal: the escalation is recorded either way.
  await notifyBuyerEscalation({
    rmSheetId: po.rm_sheet_id,
    buyerId: po.created_by,
    itemCode: po.po_number ?? "this purchase order",
    lot: null,
    reason: reason.trim(),
    slaHours: WORKING_HOURS_SLA,
  });
  // Also push anything already past its SLA, so the MD is not waiting on
  // someone opening their dashboard.
  await notifyMdEscalations();

  revalidatePath("/procurement/po-approvals");
  return { error: null, ok: true };
}
