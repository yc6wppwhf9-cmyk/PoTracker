"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { sendEmail, appUrl, escapeHtml } from "@/lib/notify";

export type MdState = { error: string | null; ok: boolean };

export async function mdDecision(
  _prev: MdState,
  formData: FormData
): Promise<MdState> {
  const me = await requireRole("md");
  const supabase = await createClient();

  const approvalId = String(formData.get("approval_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!approvalId) return { error: "Missing approval.", ok: false };
  if (decision !== "approved" && decision !== "rejected")
    return { error: "Invalid decision.", ok: false };

  const { data: rows } = await supabase
    .from("approval")
    .select("id, rm_sheet_id")
    .eq("id", approvalId)
    .limit(1);
  const approval = rows?.[0];
  if (!approval) return { error: "Approval not found.", ok: false };

  const { error } = await supabase
    .from("approval")
    .update({ md_id: me.userId, md_decision: decision })
    .eq("id", approvalId);
  if (error) return { error: error.message, ok: false };

  await supabase
    .from("rm_sheet")
    .update({ status: decision === "approved" ? "approved" : "rejected" })
    .eq("id", approval.rm_sheet_id);

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "approval",
    entity_id: approvalId,
    action: `md_${decision}`,
    detail: { rm_sheet_id: approval.rm_sheet_id },
  });

  // Notify the uploader + purchase head(s).
  const { data: sheet } = await supabase
    .from("rm_sheet")
    .select("uploaded_by, style_ref")
    .eq("id", approval.rm_sheet_id)
    .limit(1)
    .then((r) => ({ data: r.data?.[0] }));

  const recipients = new Set<string>();
  if (sheet?.uploaded_by) {
    const { data: up } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", sheet.uploaded_by)
      .limit(1);
    if (up?.[0]?.email) recipients.add(up[0].email);
  }
  const { data: heads } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "purchase_head");
  for (const h of heads ?? []) if (h.email) recipients.add(h.email);

  await sendEmail({
    to: [...recipients],
    subject: `MD ${decision} — ${sheet?.style_ref ?? "PO"}`,
    html: `<p>The Managing Director <strong>${decision}</strong> the PO for ${escapeHtml(
      sheet?.style_ref ?? "the sheet"
    )}.</p><p><a href="${appUrl("/dashboard")}">Open the app</a></p>`,
  });

  revalidatePath("/procurement/md");
  return { error: null, ok: true };
}

export async function submitMdDecision(formData: FormData): Promise<void> {
  await mdDecision({ error: null, ok: false }, formData);
}
