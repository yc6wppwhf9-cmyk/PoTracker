"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export type SaveLinesState = { error: string | null; ok: boolean };

/** Turn a Postgres permission error into something the user can act on. */
function explainWriteFailure(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("permission denied"))
    return (
      "Your role does not have permission to edit PO lines. Apply " +
      "supabase/migrations/20260805_po_team_can_edit_po_lines.sql, then retry."
    );
  return message;
}

export type LineEdit = {
  id: string;
  ordered_qty: number;
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

  let changed = 0;
  for (const e of edits) {
    const { data, error } = await supabase
      .from("po_line")
      .update({ ordered_qty: e.ordered_qty })
      .eq("id", e.id)
      .eq("po_id", poId)
      .select("id");
    if (error) return { error: explainWriteFailure(error.message), ok: false };
    changed += data?.length ?? 0;
  }

  // RLS denies an UPDATE by returning zero affected rows rather than an error,
  // so a silent no-op would otherwise look like a successful save.
  if (changed === 0)
    return {
      error:
        "Nothing was saved — your role does not have permission to edit PO " +
        "lines. Apply supabase/migrations/20260805_po_team_can_edit_po_lines.sql.",
      ok: false,
    };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "po",
    entity_id: poId,
    action: "po_lines_edited",
    detail: {
      lines: edits.length,
      quantities: edits.map((e) => ({ id: e.id, ordered_qty: e.ordered_qty })),
    },
  });

  revalidatePath("/procurement/po-team");
  revalidatePath("/procurement/reconciliation");
  return { error: null, ok: true };
}
