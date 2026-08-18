"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notifyPoDrafted } from "@/lib/notify";
import { isKnownBillTo } from "@/lib/sites";

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
  bill_to?: string | null;
  ship_to?: string | null;
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

  // One PO per supplier, delivery date, bill-to and ship-to. The printed
  // purchase order carries exactly one visible value for each of those fields,
  // so a buyer cannot mix incompatible addresses or destinations on one draft.
  const badBillTo = lines.find((l) => (l.bill_to ?? l.site) && !isKnownBillTo(l.bill_to ?? l.site));
  if (badBillTo)
    return {
      error: `Unknown bill-to location: ${badBillTo.bill_to ?? badBillTo.site}.`,
      poId: null,
    };

  // Grouped by supplier alone. ETD and site are now per line, so a supplier
  // shipping to two sites on two dates is one order with four lines rather
  // than four separate POs — which is what the supplier actually receives.
  const groups = new Map<string, LineInput[]>();
  for (const l of lines) {
    const key = l.supplier?.trim() || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  const created: string[] = [];
  for (const [supplier, group] of groups) {
    // po.etd and po.site are kept in step where the whole order agrees, since
    // that is what older screens and the document itself read. Where the lines
    // differ there is no order-level answer, and null is the honest one.
    const only = (vals: (string | null | undefined)[]) => {
      const set = new Set(vals.map((v) => v || "").filter(Boolean));
      return set.size === 1 ? [...set][0] : null;
    };

    const { data: poRows, error: poErr } = await supabase
      .from("po")
      .insert({
        rm_sheet_id: sheetId,
        created_by: me.userId,
        status: "draft",
        etd: only(group.map((l) => l.etd)),
        bill_to: only(group.map((l) => l.bill_to ?? l.site)),
        ship_to: only(group.map((l) => l.ship_to ?? null)),
        site: only(group.map((l) => l.bill_to ?? l.site)),
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
        etd: l.etd || null,
        bill_to: l.bill_to ?? l.site ?? null,
        ship_to: l.ship_to ?? null,
        site: l.bill_to ?? l.site ?? null,
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
 * ETD and delivery site on a single line of a draft.
 *
 * Per line rather than per PO: one supplier's order is routinely split across
 * sites and dates, and a single value for the whole order made the buyer either
 * split the draft or record something untrue.
 *
 * Ownership is enforced through the parent PO — a line carries no buyer of its
 * own, so checking it here rather than on po_line would leave any buyer able to
 * redate another's order.
 */
export async function updatePoLineDetails(
  lineId: string,
  etd: string | null,
  billTo: string | null,
  shipTo: string | null
): Promise<SendPoState> {
  const me = await requireRole("buyer");
  const supabase = await createClient();
  if (!lineId) return { error: "Missing line.", ok: false };
  if (billTo && !isKnownBillTo(billTo))
    return { error: `Unknown bill-to location: ${billTo}.`, ok: false };

  const { data: line, error: readErr } = await supabase
    .from("po_line")
    .select("id, po:po_id(id, status, created_by, rm_sheet_id)")
    .eq("id", lineId)
    .maybeSingle();
  if (readErr) return { error: readErr.message, ok: false };

  const po = line?.po as unknown as {
    id: string;
    status: string;
    created_by: string | null;
    rm_sheet_id: string;
  } | null;
  if (!po) return { error: "That line no longer exists.", ok: false };
  if (po.created_by !== me.userId)
    return { error: "That PO belongs to another buyer.", ok: false };
  if (po.status !== "draft")
    return {
      error: "This PO has already been sent — its lines can no longer be edited.",
      ok: false,
    };

  const { error } = await supabase
    .from("po_line")
    .update({
      etd: etd || null,
      bill_to: billTo || null,
      ship_to: shipTo || null,
      site: billTo || null,
    })
    .eq("id", lineId);
  if (error) return { error: error.message, ok: false };

  revalidatePath(`/procurement/buyer/${po.rm_sheet_id}`);
  return { error: null, ok: true };
}

/**
 * Why a draft cannot be sent yet, or null if it can.
 *
 * The PO team cannot produce a document without knowing what is being bought,
 * from whom, when it is due and where it ships — so these are required to
 * send, not to draft. Checked per line since ETD and site moved there.
 *
 * Counts are named rather than the first offender: "3 of 12 lines have no ETD"
 * tells the buyer how much work is left, which "set the ETD" does not.
 */
function readyToSend(
  lines: {
    supplier: string | null;
    etd: string | null;
    bill_to: string | null;
    ship_to: string | null;
  }[]
): string | null {
  if (lines.length === 0) return "This PO has no lines.";

  const missing = (pick: (l: (typeof lines)[number]) => string | null) =>
    lines.filter((l) => !pick(l)?.trim()).length;

  const noSupplier = missing((l) => l.supplier);
  if (noSupplier)
    return `Set the supplier on every line — ${noSupplier} of ${lines.length} still have none.`;

  const noEtd = missing((l) => l.etd);
  if (noEtd)
    return `Set the ETD on every line — ${noEtd} of ${lines.length} still have none.`;

  const noBillTo = missing((l) => l.bill_to);
  if (noBillTo)
    return `Set the bill-to on every line — ${noBillTo} of ${lines.length} still have none.`;

  const noShipTo = missing((l) => l.ship_to);
  if (noShipTo)
    return `Set the ship-to on every line — ${noShipTo} of ${lines.length} still have none.`;

  return null;
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
    .select(
      "id, status, created_by, rm_sheet_id, po_line(id, supplier, etd, bill_to, ship_to, site)"
    )
    .eq("id", poId)
    .limit(1);
  if (readErr) return { error: readErr.message, ok: false };
  const po = poRows?.[0];
  if (!po) return { error: "PO not found.", ok: false };
  if (po.created_by !== me.userId)
    return { error: "This PO was not raised by you.", ok: false };
  if (po.status !== "draft")
    return { error: "This PO has already been sent.", ok: false };

  const lines =
    (po.po_line as unknown as {
      id: string;
      supplier: string | null;
      etd: string | null;
      bill_to: string | null;
      ship_to: string | null;
      site: string | null;
    }[]) ?? [];
  const problem = readyToSend(lines);
  if (problem) return { error: problem, ok: false };

  const { data: updated, error } = await supabase
    .from("po")
    .update({ status: "sent" })
    .eq("id", poId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    // The status check constraint predates the draft -> sent step, so a
    // database that has not had the migration applied rejects the value with
    // a message that names the constraint but not the fix.
    if (error.message.includes("po_status_check"))
      return {
        error:
          "The database does not yet allow the 'sent' status. Apply " +
          "supabase/migrations/20260812_po_status_sent.sql, then retry.",
        ok: false,
      };
    return { error: error.message, ok: false };
  }
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

export type BulkSendState = {
  ok: boolean;
  error: string | null;
  sent: number;
  failures: { poId: string; reason: string }[];
};

/**
 * Send several drafts to the PO team in one go.
 *
 * A sheet routinely produces a draft per supplier, and sending twenty of them
 * one button at a time is the same confirmation twenty times.
 *
 * Each PO is sent independently and a failure does not stop the rest: they are
 * separate orders to separate suppliers, and refusing to send nineteen valid
 * ones because the twentieth lacks a site would be the wrong trade. Every
 * failure is reported by PO, so the buyer knows exactly what remains.
 */
export async function sendPosToTeam(poIds: string[]): Promise<BulkSendState> {
  await requireRole("buyer");
  const ids = [...new Set(poIds.filter(Boolean))];
  if (ids.length === 0)
    return { ok: false, error: "No POs selected.", sent: 0, failures: [] };

  // Sequential, deliberately. Each send writes a status, an audit row and a
  // mail; running them together would put the mail service under a burst it
  // has no reason to absorb, and a rate-limited notification would report a
  // PO as unsent when it had in fact been handed over.
  const failures: { poId: string; reason: string }[] = [];
  let sent = 0;
  for (const id of ids) {
    const res = await sendPoToTeam(id);
    if (res.ok) sent += 1;
    else failures.push({ poId: id, reason: res.error ?? "Unknown error." });
  }

  return {
    ok: sent > 0,
    sent,
    failures,
    error:
      failures.length === 0
        ? null
        : sent === 0
          ? `None of the ${ids.length} selected PO(s) could be sent.`
          : `${sent} of ${ids.length} PO(s) were sent; ${failures.length} could not be.`,
  };
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
