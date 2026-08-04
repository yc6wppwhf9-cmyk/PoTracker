"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export type SaveLinesState = { error: string | null; ok: boolean };

export type LineEdit = {
  id: string;
  ordered_qty: number;
  moq: number;
};

/**
 * The PO team corrects the ordered quantities to match the finalised PO
 * document they are attaching. The buyer's draft is a proposal; the signed
 * document is the truth, and reconciliation must compare against the truth.
 */
export async function savePoLines(
  poId: string,
  edits: LineEdit[]
): Promise<SaveLinesState> {
  const me = await requireRole("po_team");
  const supabase = await createClient();

  if (!poId) return { error: "Missing PO.", ok: false };
  if (edits.length === 0) return { error: "Nothing to save.", ok: false };

  for (const e of edits) {
    if (!Number.isFinite(e.ordered_qty) || e.ordered_qty <= 0)
      return { error: "Every ordered quantity must be greater than zero.", ok: false };
    if (!Number.isFinite(e.moq) || e.moq < 0)
      return { error: "MOQ cannot be negative.", ok: false };
  }

  // Only lines that actually belong to this PO may be edited — the ids come
  // from the browser and cannot be trusted.
  const { data: owned, error: readErr } = await supabase
    .from("po_line")
    .select("id")
    .eq("po_id", poId);
  if (readErr) return { error: readErr.message, ok: false };

  const ownedIds = new Set((owned ?? []).map((l) => l.id));
  const foreign = edits.filter((e) => !ownedIds.has(e.id));
  if (foreign.length > 0)
    return { error: "Some lines do not belong to this PO.", ok: false };

  for (const e of edits) {
    const { error } = await supabase
      .from("po_line")
      .update({ ordered_qty: e.ordered_qty, moq: e.moq })
      .eq("id", e.id)
      .eq("po_id", poId);
    if (error) return { error: error.message, ok: false };
  }

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "po",
    entity_id: poId,
    action: "po_lines_edited",
    detail: {
      lines: edits.length,
      quantities: edits.map((e) => ({ id: e.id, ordered_qty: e.ordered_qty, moq: e.moq })),
    },
  });

  revalidatePath("/procurement/po-team");
  revalidatePath("/procurement/reconciliation");
  return { error: null, ok: true };
}
