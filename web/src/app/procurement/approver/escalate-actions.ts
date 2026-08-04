"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { notifyBuyerEscalation } from "@/lib/notify";

const WORKING_HOURS_SLA = 9;

export type EscalateState = { error: string | null; ok: boolean };

/** Approver escalates a flagged material to its assigned buyer, with a
 *  9-working-hour SLA after which pg_cron auto-escalates it to the MD. */
export async function raiseEscalation(
  _prev: EscalateState,
  formData: FormData
): Promise<EscalateState> {
  const me = await requireRole("approver");
  const supabase = await createClient();

  const sheetId = String(formData.get("sheet_id") ?? "");
  const itemCode = String(formData.get("item_code") ?? "");
  const lotRaw = formData.get("lot");
  const lot = typeof lotRaw === "string" && lotRaw !== "" ? lotRaw : null;
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!sheetId || !itemCode)
    return { error: "Missing sheet or item.", ok: false };

  // Find the buyer assigned to this item/lot on the sheet.
  let q = supabase
    .from("rm_requirement")
    .select("assigned_buyer")
    .eq("rm_sheet_id", sheetId)
    .eq("item_code", itemCode)
    .not("assigned_buyer", "is", null)
    .limit(1);
  q = lot === null ? q.is("lot", null) : q.eq("lot", lot);
  const { data: reqRows } = await q;
  const buyerId = reqRows?.[0]?.assigned_buyer as string | undefined;
  if (!buyerId)
    return {
      error: "No buyer is assigned to this item/lot yet — assign one first.",
      ok: false,
    };

  // Deadline = 9 working hours from now (Mon–Sat 09:00–18:00 IST).
  const { data: deadline } = await supabase.rpc("add_working_hours", {
    p_start: new Date().toISOString(),
    p_hours: WORKING_HOURS_SLA,
  });

  const { error } = await supabase.from("escalation").insert({
    rm_sheet_id: sheetId,
    item_code: itemCode,
    lot,
    raised_by: me.userId,
    assigned_buyer: buyerId,
    reason,
    status: "open",
    escalate_after: deadline as unknown as string,
  });
  if (error) return { error: error.message, ok: false };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "escalation",
    entity_id: sheetId,
    action: "escalated_to_buyer",
    detail: { item_code: itemCode, lot, buyer: buyerId, reason },
  });

  // Notify the buyer. The backend resolves their address and escapes the body.
  await notifyBuyerEscalation({
    rmSheetId: sheetId,
    buyerId,
    itemCode,
    lot,
    reason,
    slaHours: WORKING_HOURS_SLA,
  });

  revalidatePath(`/procurement/approver/${sheetId}`);
  revalidatePath("/procurement/buyer");
  return { error: null, ok: true };
}

export async function resolveEscalation(
  _prev: EscalateState,
  formData: FormData
): Promise<EscalateState> {
  const me = await requireRole("buyer", "approver", "purchase_head", "md");
  const supabase = await createClient();
  const id = String(formData.get("escalation_id") ?? "");
  if (!id) return { error: "Missing escalation.", ok: false };

  const { error } = await supabase
    .from("escalation")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: me.userId,
    })
    .eq("id", id);
  if (error) return { error: error.message, ok: false };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "escalation",
    entity_id: id,
    action: "escalation_resolved",
    detail: {},
  });

  revalidatePath("/procurement/buyer");
  revalidatePath("/procurement/md");
  return { error: null, ok: true };
}
