import "server-only";
import { createClient } from "@/lib/supabase/server";
import { cleanEnv } from "@/lib/env";

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
type NotifyResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  /** Why nothing was sent, phrased for the person who pressed the button. */
  reason?: string;
  recipients?: number;
  /** Fan-out endpoints only: how many recipients actually received mail. */
  delivered?: number;
  buyers?: number;
};

async function notify(path: string, body: unknown): Promise<NotifyResult> {
  const base =
    cleanEnv("API_BASE_URL", process.env.API_BASE_URL) ||
    cleanEnv("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL);
  if (!base) {
    console.warn("[notify] no API base URL configured — skipping");
    return {
      sent: false,
      skipped: true,
      reason:
        "API_BASE_URL is not set on the web app, so it does not know where " +
        "the mail service is. Set it to your API URL and redeploy.",
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn("[notify] no session — skipping");
      return {
        sent: false,
        skipped: true,
        reason: "Your session has expired — sign in again and retry.",
      };
    }

    const res = await fetch(`${base}/notify/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error(`[notify ${path}] ${res.status} ${raw}`);
      return {
        sent: false,
        error: `HTTP ${res.status}`,
        reason: `The mail service refused the request (HTTP ${res.status}): ${raw.slice(0, 200)}`,
      };
    }

    // The API answers 200 with {"sent": false, ...} when it deliberately sent
    // nothing — no key, no recipients, or a provider rejection. Its own hint
    // is far more specific than anything that can be inferred here.
    const parsed = JSON.parse(raw) as NotifyResult & {
      hint?: string;
      detail?: string;
    };
    if (!parsed.sent && !parsed.reason)
      parsed.reason =
        parsed.hint ??
        parsed.detail ??
        (parsed.skipped
          ? "The mail service skipped this send — check /health on the API."
          : "The mail service reported that nothing was sent.");
    return parsed;
  } catch (e) {
    console.error(`[notify ${path}]`, e);
    const msg = e instanceof Error ? e.message : "failed";
    return {
      sent: false,
      error: msg,
      reason: `Could not reach the mail service at ${base} (${msg}).`,
    };
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
 * The pg_cron job auto_escalate_to_md promotes overdue escalations every 15
 * minutes but cannot mail — pg_net is not installed, so the database has no
 * way to make an outbound call. Mail therefore originates from this sweep, and
 * so nothing reaches the MD until this runs. Both halves are idempotent, so
 * calling it on page load is safe.
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
