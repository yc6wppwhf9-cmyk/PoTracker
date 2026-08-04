"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { notifyMdApproval } from "@/lib/notify";
import { STATUS_META, type ReconStatus } from "@/lib/reconciliation";
import { fetchAll } from "@/lib/supabase/fetch-all";

export type ApproveState = { error: string | null; ok: boolean };

/** Deterministic reconciliation digest (SQL counts, not the LLM). Phase 7 will
 *  replace the prose with a Claude-written version. */
function buildSummary(counts: Record<string, number>): string {
  const parts: string[] = [];
  (Object.keys(STATUS_META) as ReconStatus[]).forEach((s) => {
    const n = counts[s] ?? 0;
    if (n > 0) parts.push(`${n} ${STATUS_META[s].label.toLowerCase()}`);
  });
  return parts.length ? parts.join(", ") + "." : "No reconciliation lines.";
}

export async function approveAndSend(
  _prev: ApproveState,
  formData: FormData
): Promise<ApproveState> {
  const me = await requireRole("approver");
  const supabase = await createClient();
  const sheetId = String(formData.get("sheet_id") ?? "");
  if (!sheetId) return { error: "Missing sheet.", ok: false };

  // Build the summary from the reconciliation view.
  // Paged: a truncated read would build the MD's summary from the first 1000
  // lines only, understating every status count.
  const recon = await fetchAll((from, to) =>
    supabase
      .from("reconciliation")
      .select("status")
      .eq("rm_sheet_id", sheetId)
      .order("item_code")
      .order("lot")
      .order("location")
      .range(from, to)
  );
  const counts: Record<string, number> = {};
  for (const r of recon) if (r.status) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const summary = buildSummary(counts);

  // One approval row per sheet: update if present, else insert.
  const { data: existing } = await supabase
    .from("approval")
    .select("id")
    .eq("rm_sheet_id", sheetId)
    .limit(1);

  const payload = {
    approver_id: me.userId,
    approver_decision: "approved" as const,
    sent_to_md_at: new Date().toISOString(),
    md_decision: "pending" as const,
    md_summary: summary,
  };

  let approvalId: string | null = null;
  if (existing?.[0]) {
    const { data, error } = await supabase
      .from("approval")
      .update(payload)
      .eq("id", existing[0].id)
      .select("id")
      .limit(1);
    if (error) return { error: error.message, ok: false };
    approvalId = data?.[0]?.id ?? existing[0].id;
  } else {
    const { data, error } = await supabase
      .from("approval")
      .insert({ rm_sheet_id: sheetId, ...payload })
      .select("id")
      .limit(1);
    if (error) return { error: error.message, ok: false };
    approvalId = data?.[0]?.id ?? null;
  }

  await supabase.from("rm_sheet").update({ status: "reconciled" }).eq("id", sheetId);

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "approval",
    entity_id: approvalId,
    action: "sent_to_md",
    detail: { summary, counts },
  });

  // Notify the MD(s). Recipients and body are resolved by the backend.
  await notifyMdApproval(sheetId, summary);

  revalidatePath("/procurement/approver");
  revalidatePath(`/procurement/approver/${sheetId}`);
  revalidatePath("/procurement/md");
  return { error: null, ok: true };
}

export async function submitApproveAndSend(formData: FormData): Promise<void> {
  await approveAndSend({ error: null, ok: false }, formData);
}
