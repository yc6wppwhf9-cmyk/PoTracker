"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notifyPoDrafted } from "@/lib/notify";

export type CreatePoState = { error: string | null; poId: string | null };

type LineInput = {
  item_code: string;
  lot: string | null;
  location: string | null;
  ordered_qty: number;
  moq: number;
  supplier?: string | null;
  rate?: number | null;
  remark?: string | null;
};

const lotKey = (item_code: string, lot: string | null, location: string | null) =>
  `${item_code}__${lot ?? ""}__${location ?? ""}`;

export async function createPo(
  _prev: CreatePoState,
  formData: FormData
): Promise<CreatePoState> {
  const me = await requireRole("buyer");
  const supabase = await createClient();

  const sheetId = String(formData.get("sheet_id") ?? "");
  if (!sheetId) return { error: "Missing sheet.", poId: null };

  let lines: LineInput[];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { error: "Malformed line payload.", poId: null };
  }
  const withQty = lines.filter((l) => l.item_code && Number(l.ordered_qty) > 0);
  if (withQty.length === 0)
    return {
      error:
        lines.length > 0
          ? "Every selected line has a quantity of zero or less. Enter a positive order quantity."
          : "Add an ordered quantity for at least one item.",
      poId: null,
    };
  lines = withQty;

  const negativeRate = lines.filter((l) => l.rate != null && Number(l.rate) < 0);
  if (negativeRate.length > 0)
    return { error: "Rate cannot be negative.", poId: null };

  // Only allow (item, lot) pairs actually assigned to this buyer on this sheet.
  // Paged: a truncated allowlist would reject lines the buyer is legitimately
  // assigned to, blocking valid POs.
  const assigned = await fetchAll((from, to) =>
    supabase
      .from("rm_requirement")
      .select("item_code, lot, location")
      .eq("rm_sheet_id", sheetId)
      .eq("assigned_buyer", me.userId)
      .not("item_code", "is", null)
      .order("id")
      .range(from, to)
  );
  const allowed = new Set(
    assigned.map((r) =>
      lotKey(r.item_code as string, r.lot as string | null, r.location as string | null)
    )
  );

  const invalid = lines.filter(
    (l) => !allowed.has(lotKey(l.item_code, l.lot, l.location))
  );
  if (invalid.length > 0)
    return {
      error: `Not assigned to you: ${invalid
        .map((l) => `${l.item_code}${l.lot ? ` / ${l.lot}` : ""}`)
        .slice(0, 3)
        .join(", ")}`,
      poId: null,
    };

  // Create the PO draft.
  const { data: poRows, error: poErr } = await supabase
    .from("po")
    .insert({ rm_sheet_id: sheetId, created_by: me.userId, status: "draft" })
    .select("id")
    .limit(1);
  if (poErr || !poRows?.[0])
    return { error: poErr?.message ?? "Could not create PO.", poId: null };
  const poId = poRows[0].id;

  const { error: lineErr } = await supabase.from("po_line").insert(
    lines.map((l) => ({
      po_id: poId,
      item_code: l.item_code,
      lot: l.lot ?? null,
      location: l.location ?? null,
      ordered_qty: Number(l.ordered_qty),
      moq: Number(l.moq) || 0,
      supplier: l.supplier?.trim() ? l.supplier.trim() : null,
      rate:
        l.rate == null || !Number.isFinite(Number(l.rate))
          ? null
          : Number(l.rate),
      remark: l.remark?.trim() ? l.remark.trim() : null,
    }))
  );
  if (lineErr) return { error: lineErr.message, poId: null };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "po",
    entity_id: poId,
    action: "po_drafted",
    detail: { sheet_id: sheetId, lines: lines.length },
  });

  // Hand off to the PO team. Non-fatal: the draft is already created.
  await notifyPoDrafted(poId);

  revalidatePath(`/procurement/buyer/${sheetId}`);
  revalidatePath("/procurement/po-team");
  return { error: null, poId };
}
