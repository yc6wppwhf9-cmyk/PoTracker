import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Notifications are sent by the FastAPI backend, which holds the Resend key —
 * all third-party secrets live behind one service.
 *
 * Each call names a notification; the backend resolves recipients and body
 * itself from the database. Nothing here supplies an address or HTML, so this
 * cannot be used to send arbitrary mail.
 *
 * Degrades gracefully: a notification failure must never roll back the action
 * that triggered it, since that action has already been committed.
 */
type NotifyResult = { sent: boolean; skipped?: boolean; error?: string };

async function notify(path: string, body: unknown): Promise<NotifyResult> {
  const base = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    console.warn("[notify] no API base URL configured — skipping");
    return { sent: false, skipped: true };
  }

  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn("[notify] no session — skipping");
      return { sent: false, skipped: true };
    }

    const res = await fetch(`${base}/notify/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`[notify ${path}] ${res.status} ${await res.text()}`);
      return { sent: false, error: `HTTP ${res.status}` };
    }
    return (await res.json()) as NotifyResult;
  } catch (e) {
    console.error(`[notify ${path}]`, e);
    return { sent: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/** Purchase head assigned buyers — each buyer is told about their own items. */
export function notifyBuyersAssigned(rmSheetId: string) {
  return notify("buyers-assigned", { rm_sheet_id: rmSheetId });
}

/** Buyer raised a PO draft — the PO team prepares the document. */
export function notifyPoDrafted(poId: string) {
  return notify("po-drafted", { po_id: poId });
}

/**
 * Mail the MD about items escalated to them past the SLA.
 *
 * The MD is mailed for escalations only — not for every approval package — so
 * the alert still means something.
 *
 * The sweep also promotes escalations whose SLA has passed. pg_cron was meant
 * to do that, but it is not installed on this project, so nothing set
 * `md_escalated` and the MD dashboard stayed empty. Both operations are
 * idempotent, so calling this on page load is safe.
 */
export function notifyMdEscalations() {
  return notify("md-escalations", {});
}

/** Approver escalated a flagged material to its assigned buyer. */
export function notifyBuyerEscalation(args: {
  rmSheetId: string;
  buyerId: string;
  itemCode: string;
  lot: string | null;
  reason: string | null;
  slaHours: number;
}) {
  return notify("buyer-escalation", {
    rm_sheet_id: args.rmSheetId,
    buyer_id: args.buyerId,
    item_code: args.itemCode,
    lot: args.lot,
    reason: args.reason,
    sla_hours: args.slaHours,
  });
}

/** MD approved or rejected a package. */
export function notifyMdDecision(rmSheetId: string, decision: string) {
  return notify("md-decision", { rm_sheet_id: rmSheetId, decision });
}

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}
