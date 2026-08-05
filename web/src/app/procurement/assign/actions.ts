"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notifyBuyersAssigned } from "@/lib/notify";

export type AssignState = { error: string | null; ok: boolean };

const UNMATCHED = "__unmatched__";

/**
 * Assign buyers to a sheet's requirement lines, by category. The client submits
 * one (category -> buyerId) entry per category; we resolve the line ids server
 * side and update assigned_buyer. Empty buyerId unassigns.
 */
export async function saveAssignments(
  _prev: AssignState,
  formData: FormData
): Promise<AssignState> {
  const me = await requireRole("purchase_head");
  const supabase = await createClient();

  const sheetId = String(formData.get("sheet_id") ?? "");
  if (!sheetId) return { error: "Missing sheet.", ok: false };

  // assignments come as JSON: [{ category, itemCode, buyerId }]
  let assignments: { category?: string; itemCode?: string; buyerId: string }[];
  try {
    assignments = JSON.parse(String(formData.get("assignments") ?? "[]"));
  } catch {
    return { error: "Malformed assignment payload.", ok: false };
  }

  // Fetch every line for the sheet with item_code & catalogue category.
  // Paged: a truncated read here would assign buyers to only the first 1000
  // lines and silently leave the rest unassigned.
  let lines: { id: string; item_code: string | null; item_master: unknown }[];
  try {
    lines = await fetchAll((from, to) =>
      supabase
        .from("rm_requirement")
        .select("id, item_code, item_master(category)")
        .eq("rm_sheet_id", sheetId)
        .order("id")
        .range(from, to)
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Read failed.", ok: false };
  }

  // Group line ids by category key & item code key.
  const byCategory = new Map<string, string[]>();
  const byItemCode = new Map<string, string[]>();

  for (const l of lines) {
    const cat =
      l.item_code == null
        ? UNMATCHED
        : ((l.item_master as { category?: string } | null)?.category ??
          UNMATCHED);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(l.id);

    if (l.item_code) {
      const code = String(l.item_code).trim().toUpperCase();
      if (!byItemCode.has(code)) byItemCode.set(code, []);
      byItemCode.get(code)!.push(l.id);
    }
  }

  const chunk = <T,>(arr: T[], n: number) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
      arr.slice(i * n, i * n + n)
    );

  let updated = 0;
  for (const { category, itemCode, buyerId } of assignments) {
    let ids: string[] = [];
    if (itemCode) {
      ids = byItemCode.get(String(itemCode).trim().toUpperCase()) ?? [];
    } else if (category) {
      ids = byCategory.get(category) ?? [];
    }
    if (ids.length === 0) continue;
    const value = buyerId ? buyerId : null;
    for (const batch of chunk(ids, 100)) {
      const { error } = await supabase
        .from("rm_requirement")
        .update({ assigned_buyer: value })
        .in("id", batch);
      if (error) return { error: error.message, ok: false };
      updated += batch.length;
    }
  }

  // Mark the sheet 'assigned' once every matched line has a buyer. Paged: a
  // truncated read would call the sheet fully assigned after 1000 lines.
  const matched = await fetchAll((from, to) =>
    supabase
      .from("rm_requirement")
      .select("id, assigned_buyer")
      .eq("rm_sheet_id", sheetId)
      .not("item_code", "is", null)
      .order("id")
      .range(from, to)
  );
  const allAssigned =
    matched.length > 0 && matched.every((r) => r.assigned_buyer != null);

  await supabase
    .from("rm_sheet")
    .update({ status: allAssigned ? "assigned" : "uploaded" })
    .eq("id", sheetId);

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "rm_sheet",
    entity_id: sheetId,
    action: "assigned",
    detail: { lines_updated: updated, all_assigned: allAssigned },
  });

  // Deliberately does NOT mail the buyers. Saving is a working step — the head
  // routes a few categories, comes back, changes their mind — and mailing on
  // every save would spam the buyers with drafts. Notification is the separate
  // explicit action below.
  revalidatePath(`/procurement/assign/${sheetId}`);
  revalidatePath("/procurement/assign");
  revalidatePath("/procurement/buyer");
  return { error: null, ok: true };
}

export type NotifyBuyersState = {
  error: string | null;
  ok: boolean;
  sent: number;
};

/**
 * Send each buyer the list of what they have been assigned. Separate from
 * saving so the purchase head decides when the routing is final; until this
 * runs, no buyer hears anything.
 */
export async function notifyBuyersAction(
  _prev: NotifyBuyersState,
  formData: FormData
): Promise<NotifyBuyersState> {
  const me = await requireRole("purchase_head");
  const supabase = await createClient();

  const sheetId = String(formData.get("sheet_id") ?? "");
  if (!sheetId) return { error: "Missing sheet.", ok: false, sent: 0 };

  // head:true fetches the count without the rows — this only needs to know
  // whether there is anything to announce.
  const { count } = await supabase
    .from("rm_requirement")
    .select("id", { count: "exact", head: true })
    .eq("rm_sheet_id", sheetId)
    .not("assigned_buyer", "is", null);

  if ((count ?? 0) === 0)
    return {
      error: "No lines are assigned yet — assign buyers and save first.",
      ok: false,
      sent: 0,
    };

  // Mail is skipped rather than failed in several distinct situations, so the
  // reason is carried up rather than guessed at here — an earlier version
  // blamed the API's mail configuration for every case, including ones where
  // the API was configured correctly and never heard from us at all.
  const res = await notifyBuyersAssigned(sheetId);
  if (!res.sent)
    return {
      error: `Assignments are saved, but no mail was sent. ${
        res.reason ?? res.error ?? "Reason unknown."
      }`,
      ok: false,
      sent: 0,
    };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "rm_sheet",
    entity_id: sheetId,
    action: "buyers_notified",
    detail: {
      assigned_lines: count ?? 0,
      buyers: res.buyers ?? null,
      delivered: res.delivered ?? null,
    },
  });

  revalidatePath(`/procurement/assign/${sheetId}`);
  // Report buyers reached, not lines — "notified 50" reads as 50 emails.
  return { error: null, ok: true, sent: res.delivered ?? res.buyers ?? 1 };
}

/**
 * Delete a sheet and everything hanging off it.
 *
 * Two deliberate restrictions, because this cascade is irreversible:
 *
 *  - Admin only. The purchase head used to hold this, for no better reason
 *    than the button living on their screen.
 *  - Refused once any buyer is assigned. Assignment is the point where the
 *    sheet stops being a draft and becomes work other people are doing, and
 *    everything downstream — POs, approvals, escalations — hangs off it.
 *
 * The role is checked without requireRole() because that redirects, which in a
 * server action surfaces as a confusing navigation rather than a message.
 */
export async function deleteSheetAction(sheetId: string) {
  const me = await requireUser();
  if (me.role !== "admin")
    throw new Error(
      "Only an administrator can delete an RM sheet. Ask an admin if this " +
        "sheet was uploaded in error."
    );
  const supabase = await createClient();

  const { count: assignedCount } = await supabase
    .from("rm_requirement")
    .select("id", { count: "exact", head: true })
    .eq("rm_sheet_id", sheetId)
    .not("assigned_buyer", "is", null);

  if ((assignedCount ?? 0) > 0)
    throw new Error(
      `This sheet cannot be deleted — ${assignedCount} line(s) are already ` +
        "assigned to buyers. Deleting it would destroy their POs and any " +
        "approvals raised against it."
    );

  // Record what is about to be destroyed while it can still be read. This
  // cascade removes a sheet, its requirements, its POs and its approvals with
  // no way back, and until now left no trace of having happened — so a sheet
  // could vanish with the audit trail still showing "uploaded" as its last
  // event, and no record of who removed it.
  const { data: doomed } = await supabase
    .from("rm_sheet")
    .select("style_ref, status")
    .eq("id", sheetId)
    .maybeSingle();
  const { count: lineCount } = await supabase
    .from("rm_requirement")
    .select("id", { count: "exact", head: true })
    .eq("rm_sheet_id", sheetId);

  await supabase.from("approval").delete().eq("rm_sheet_id", sheetId);
  await supabase.from("escalation").delete().eq("rm_sheet_id", sheetId);
  const { data: pos } = await supabase.from("po").select("id").eq("rm_sheet_id", sheetId);
  const poIds = (pos ?? []).map((p) => p.id);
  if (poIds.length > 0) {
    await supabase.from("po_line").delete().in("po_id", poIds);
    await supabase.from("po").delete().eq("rm_sheet_id", sheetId);
  }
  await supabase.from("rm_requirement").delete().eq("rm_sheet_id", sheetId);
  const { error } = await supabase.from("rm_sheet").delete().eq("id", sheetId);

  // Logged only on success, so a refused delete is not recorded as one. The
  // row outlives the sheet: audit_log.entity_id is a bare uuid, not a foreign
  // key, which is what makes a deletion trail possible at all.
  if (!error) {
    await supabase.from("audit_log").insert({
      actor_id: me.userId,
      entity: "rm_sheet",
      entity_id: sheetId,
      action: "sheet_deleted",
      detail: {
        style_ref: doomed?.style_ref ?? null,
        status: doomed?.status ?? null,
        requirement_lines: lineCount ?? null,
        purchase_orders: poIds.length,
      },
    });
  }

  revalidatePath("/procurement/assign");
  revalidatePath("/procurement/reconciliation");
  revalidatePath("/procurement/buyer");
  revalidatePath("/procurement/approver");
  revalidatePath("/procurement/md");

  if (error) {
    throw new Error(`Deletion failed: ${error.message}. Please check Supabase RLS DELETE policies.`);
  }
  return { ok: true };
}
