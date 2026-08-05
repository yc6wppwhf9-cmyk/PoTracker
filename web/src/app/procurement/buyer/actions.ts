"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/fetch-all";
// Notification for drafts is now sent explicitly via the "Send" action.
// The buyer creating a draft should not trigger a notification.


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

  // One PO per supplier. A purchase order is issued to a single supplier and
  // the signed document is attached to the `po` row, so a draft mixing
  // suppliers could only ever carry one of their documents. Lines with no
  // supplier yet are grouped together under a single unassigned draft, which
  // the PO team can still work on.
  const bySupplier = new Map<string, LineInput[]>();
  for (const l of lines) {
    const key = l.supplier?.trim() || "";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(l);
  }

  const created: string[] = [];
  for (const [supplier, group] of bySupplier) {
    const { data: poRows, error: poErr } = await supabase
      .from("po")
      .insert({ rm_sheet_id: sheetId, created_by: me.userId, status: "draft" })
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

    // The draft is created, but do not notify the PO team yet. A buyer must
    // explicitly Send the draft to hand it off. This prevents noisy mail on
    // intermediate drafts.
    created.push(poId);
  }

  revalidatePath(`/procurement/buyer/${sheetId}`);
  revalidatePath("/procurement/po-team");
  return { error: null, poId: created[0] ?? null, count: created.length };
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

/*
 * Server action: send a drafted PO. This calls the API service which holds
 * the sending credentials. The API marks the PO as sent and notifies the PO
 * team. The web action mirrors the API result and revalidates pages.
 */
export async function sendPo(formData: FormData): Promise<void> {
  await requireRole("buyer");
  const poId = String(formData.get("po_id") ?? "");
  if (!poId) throw new Error("Missing PO.");

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const base =
    process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL not configured on the web app.");
  if (!session?.access_token) throw new Error("Session expired; sign in again.");

  const res = await fetch(`${base.replace(/\/+$/,'')}/pos/${poId}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Send failed: HTTP ${res.status} ${raw.slice(0,200)}`);
  }
  // Try to parse JSON but ignore if not JSON.
  try {
    const parsed = JSON.parse(raw);
    // Revalidate relevant pages. If the API returned the sheet id, use it.
    if (parsed?.notified || parsed?.status) {
      // best-effort revalidation
      revalidatePath("/procurement/buyer");
      revalidatePath("/procurement/po-team");
      revalidatePath("/procurement/reconciliation");
    }
  } catch {}

  return;
}
