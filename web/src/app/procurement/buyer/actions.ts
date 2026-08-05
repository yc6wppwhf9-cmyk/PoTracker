"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notifyPoDrafted } from "@/lib/notify";
import { isKnownSite } from "@/lib/sites";

export type CreatePoState = {
  error: string | null;
  poId: string | null;
  /** How many drafts were created — one per distinct supplier. */
  count?: number;
};

type LineInput = {
  item_code: string;
  lot: string | null;
  location: string | null;
  ordered_qty: number;
  supplier?: string | null;
  rate?: number | null;
  remark?: string | null;
  etd?: string | null;
  site?: string | null;
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

  // One PO per supplier, delivery date and destination. A purchase order
  // document carries exactly one of each — one vendor, one delivery date, one
  // ship-to — and the signed document is attached to the `po` row, so a draft
  // mixing any of them could only ever match one of its lines. Lines missing a
  // value group together and the PO team can still work on them.
  const badSite = lines.find((l) => l.site && !isKnownSite(l.site));
  if (badSite)
    return { error: `Unknown delivery site: ${badSite.site}.`, poId: null };

  const groups = new Map<string, LineInput[]>();
  for (const l of lines) {
    const key = [l.supplier?.trim() || "", l.etd || "", l.site || ""].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  const created: string[] = [];
  for (const [key, group] of groups) {
    const [supplier, etd, site] = key.split("|");
    const { data: poRows, error: poErr } = await supabase
      .from("po")
      .insert({
        rm_sheet_id: sheetId,
        created_by: me.userId,
        status: "draft",
        etd: etd || null,
        site: site || null,
      })
      .select("id")
      .limit(1);
    if (poErr || !poRows?.[0])
      return {
        error: partial(
          created,
          poErr?.message ?? "Could not create PO.",
          supplier
        ),
        poId: created[0] ?? null,
      };
    const poId = poRows[0].id;

    const { error: lineErr } = await supabase.from("po_line").insert(
      group.map((l) => ({
        po_id: poId,
        item_code: l.item_code,
        lot: l.lot ?? null,
        location: l.location ?? null,
        ordered_qty: Number(l.ordered_qty),
        // MOQ is not part of this process; the column keeps its 0 default so
        // the reconciliation view's expected_max falls back to the requirement.
        moq: 0,
        supplier: supplier || null,
        rate:
          l.rate == null || !Number.isFinite(Number(l.rate))
            ? null
            : Number(l.rate),
        remark: l.remark?.trim() ? l.remark.trim() : null,
      }))
    );
    if (lineErr) {
      // Leave no empty PO behind for the PO team to puzzle over.
      await supabase.from("po").delete().eq("id", poId);
      return {
        error: partial(created, lineErr.message, supplier),
        poId: created[0] ?? null,
      };
    }

    await supabase.from("audit_log").insert({
      actor_id: me.userId,
      entity: "po",
      entity_id: poId,
      action: "po_drafted",
      detail: {
        sheet_id: sheetId,
        lines: group.length,
        supplier: supplier || null,
      },
    });

    // Deliberately no notification here. A draft is the buyer's working copy —
    // they raise it, revise it, may delete it — and the PO team neither sees it
    // nor hears about it until the buyer sends it explicitly. See sendPoToTeam.
    created.push(poId);
  }

  revalidatePath(`/procurement/buyer/${sheetId}`);
  revalidatePath("/procurement/po-team");
  return { error: null, poId: created[0] ?? null, count: created.length };
}

export type SendPoState = { error: string | null; ok: boolean };

/**
 * Correct the ETD or delivery site on a draft before it is sent.
 *
 * One submit can create several drafts — one per supplier — all carrying the
 * same order-level values, and suppliers rarely deliver on the same date. RLS
 * permits this only while the PO is a draft and only for its creator.
 */
export async function updatePoDetails(
  poId: string,
  etd: string | null,
  site: string | null
): Promise<SendPoState> {
  const me = await requireRole("buyer");
  const supabase = await createClient();
  if (!poId) return { error: "Missing PO.", ok: false };
  if (site && !isKnownSite(site))
    return { error: `Unknown delivery site: ${site}.`, ok: false };

  const { data, error } = await supabase
    .from("po")
    .update({ etd: etd || null, site: site || null })
    .eq("id", poId)
    .eq("created_by", me.userId)
    .eq("status", "draft")
    .select("id, rm_sheet_id");
  if (error) return { error: error.message, ok: false };
  if ((data?.length ?? 0) === 0)
    return {
      error: "Could not update — the PO may already have been sent.",
      ok: false,
    };

  revalidatePath(`/procurement/buyer/${data![0].rm_sheet_id}`);
  return { error: null, ok: true };
}

/**
 * Hand a draft to the PO team.
 *
 * This is the only point at which a PO becomes visible to them and the only
 * point that sends mail. Until it runs the draft is private to the buyer, so
 * they can revise or abandon it without anyone downstream reacting to a
 * half-finished order.
 */
export async function sendPoToTeam(poId: string): Promise<SendPoState> {
  const me = await requireRole("buyer");
  const supabase = await createClient();
  if (!poId) return { error: "Missing PO.", ok: false };

  const { data: poRows, error: readErr } = await supabase
    .from("po")
    .select("id, status, created_by, rm_sheet_id, etd, site, po_line(id, supplier)")
    .eq("id", poId)
    .limit(1);
  if (readErr) return { error: readErr.message, ok: false };
  const po = poRows?.[0];
  if (!po) return { error: "PO not found.", ok: false };
  if (po.created_by !== me.userId)
    return { error: "This PO was not raised by you.", ok: false };
  if (po.status !== "draft")
    return { error: "This PO has already been sent.", ok: false };

  const lines = (po.po_line as unknown as { id: string; supplier: string | null }[]) ?? [];
  if (lines.length === 0)
    return { error: "This PO has no lines.", ok: false };
  // The PO team cannot produce a document without knowing when it is due and
  // where it ships, so these are required to send rather than to draft.
  if (!po.etd) return { error: "Set the ETD before sending this PO.", ok: false };
  if (!po.site)
    return { error: "Set the delivery site before sending this PO.", ok: false };
  // The PO team's whole job is to produce the document for a named supplier,
  // so sending one without a supplier would hand them an unanswerable task.
  if (lines.some((l) => !l.supplier?.trim()))
    return {
      error: "Set the supplier on every line before sending this PO.",
      ok: false,
    };

  const { data: updated, error } = await supabase
    .from("po")
    .update({ status: "sent" })
    .eq("id", poId)
    .eq("status", "draft")
    .select("id");
  if (error) return { error: error.message, ok: false };
  if ((updated?.length ?? 0) === 0)
    return { error: "Could not send this PO — it may already have been sent.", ok: false };

  await supabase.from("audit_log").insert({
    actor_id: me.userId,
    entity: "po",
    entity_id: poId,
    action: "po_sent_to_team",
    detail: { lines: lines.length, supplier: lines[0]?.supplier ?? null },
  });

  const res = await notifyPoDrafted(poId);

  revalidatePath(`/procurement/buyer/${po.rm_sheet_id}`);
  revalidatePath("/procurement/po-team");
  if (!res.sent)
    return {
      error: `PO sent to the PO team, but no mail went out. ${
        res.reason ?? res.error ?? ""
      }`,
      ok: false,
    };
  return { error: null, ok: true };
}

/** A later supplier failing must not read as though nothing was created. */
function partial(created: string[], message: string, supplier: string): string {
  const who = supplier || "the lines with no supplier";
  if (created.length === 0) return message;
  return (
    `${created.length} PO draft(s) were created, but the one for ${who} ` +
    `failed: ${message}. Deselect the lines already drafted before retrying.`
  );
}
