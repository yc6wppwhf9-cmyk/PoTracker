"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

/** Turn a Postgres permission error into something the user can act on. */
function explainWriteFailure(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("permission denied"))
    return (
      "Your role does not have permission to change this purchase order. " +
      "Capturing the PO number requires the po_team role."
    );
  return message;
}

/*
 * savePoLines() and its LineEdit type were removed here.
 *
 * The PO team used to correct ordered quantities to match the signed
 * document. That inverted the record: the quantity is the buyer's decision
 * and the document is produced FROM it, so an editable field let the record
 * be moved to match the paperwork in the one place where a mismatch between
 * the two is what you want to notice.
 *
 * Removed at every layer rather than hidden — the RLS policy that permitted
 * it is dropped in 20260817_po_team_cannot_edit_quantities.sql, so a request
 * posted directly to the API is refused too.
 */

export type PoNumberState = { error: string | null; ok: boolean };

/**
 * Correct the supplier-facing PO number on an attached PO.
 *
 * It is read out of the PDF at upload, which is convenient but not
 * authoritative — layouts vary and a scanned document yields no text at all.
 * This is the identifier the GRN register joins on, so it has to be
 * correctable by the person holding the document.
 */
export async function savePoNumber(
  poId: string,
  poNumber: string
): Promise<PoNumberState> {
  await requireRole("po_team");
  const supabase = await createClient();
  if (!poId) return { error: "Missing PO.", ok: false };

  const value = poNumber.trim().toUpperCase();
  if (!value) return { error: "Enter the PO number from the document.", ok: false };

  const { data, error } = await supabase
    .from("po")
    .update({ po_number: value })
    .eq("id", poId)
    .select("id");

  if (error) {
    // The unique index exists so two POs cannot claim one number, which would
    // make GRN matching ambiguous in a way no later code could resolve.
    if (error.code === "23505" || error.message.includes("po_po_number_key"))
      return {
        error: `PO number ${value} already belongs to another purchase order.`,
        ok: false,
      };
    return { error: explainWriteFailure(error.message), ok: false };
  }
  if ((data?.length ?? 0) === 0)
    return { error: explainWriteFailure("row-level security"), ok: false };

  revalidatePath("/procurement/po-team");
  return { error: null, ok: true };
}
