import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  STATUS_META,
  STATUS_ORDER,
  statusVar,
  type ReconRow,
} from "@/lib/reconciliation";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { ReconTabs } from "./recon-tabs";
import { ExportButton } from "./export-button";
import { submitApproveAndSend } from "../../approver/actions";
import { EscalationPanel } from "../../approver/[sheetId]/escalation-panel";

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("purchase_head", "po_team", "approver", "md");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status")
    .eq("id", sheetId)
    .limit(1);
  const sheet = sheetRows?.[0];
  if (!sheet) notFound();

  // Paged: Supabase caps a read at 1000 rows, and a large sheet exceeds that.
  // A truncated read here under-reports every quantity on the page.
  const recon = (await fetchAll((from, to) =>
    supabase
      .from("reconciliation")
      .select("*")
      .eq("rm_sheet_id", sheetId)
      .order("item_code")
      .order("lot")
      .order("location")
      .range(from, to)
  )) as ReconRow[];

  // Lines still needing an item-code resolution (not in the view).
  const { count: needsReview } = await supabase
    .from("rm_requirement")
    .select("*", { count: "exact", head: true })
    .eq("rm_sheet_id", sheetId)
    .eq("needs_review", true);

  const counts: Record<string, number> = {};
  for (const r of recon) if (r.status) counts[r.status] = (counts[r.status] ?? 0) + 1;

  // Approving and escalating are approver actions. Everyone else
  // (purchase_head, po_team, md) sees the same reconciliation read-only.
  const canApprove = profile.role === "approver" || profile.role === "admin";

  const { data: approvalRows } = canApprove
    ? await supabase.from("approval").select("*").eq("rm_sheet_id", sheetId).limit(1)
    : { data: null };
  const approval = approvalRows?.[0];
  const isSentToMd = Boolean(approval?.sent_to_md_at);

  return (
    <AppShell profile={profile}>
      <Link
        href="/procurement/reconciliation"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← All sheets
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {sheet.style_ref ?? `Sheet ${sheet.id.slice(0, 8)}`}
        </h1>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium dark:bg-neutral-800">
            {sheet.status}
          </span>
          {recon.length > 0 && <ExportButton sheetId={sheetId} />}
        </div>
      </div>
      <p className="mt-1 text-neutral-500">
        Reconciliation of {recon.length} item(s) — purchased vs required.
        {needsReview ? ` ${needsReview} line(s) still need an item-code match.` : ""}
      </p>



      <div className="mt-8">
        {recon.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            Nothing to reconcile yet — no requirements or POs for this sheet.
          </p>
        ) : (
          <ReconTabs rows={recon} />
        )}
      </div>

      {canApprove && recon.length > 0 && (
        <>
          {/* Escalate a flagged line to its assigned buyer. */}
          <div className="mt-10">
            <EscalationPanel sheetId={sheetId} />
          </div>

          {/* Send the package on to the Managing Director. */}
          <div className="mt-10 rounded-2xl border border-black/[0.08] bg-white p-6 dark:border-white/[0.08] dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                Approve &amp; send to Managing Director
              </h2>
              {isSentToMd && (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                  Already sent to MD
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              Verify the breakdown above before sending. The MD sees a digest of
              these counts.
            </p>

            {approval?.md_summary && (
              <div className="mt-4 rounded-xl border border-black/[0.06] bg-neutral-50 p-4 dark:border-white/[0.06] dark:bg-neutral-800/50">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Summary the MD will see
                </div>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                  {approval.md_summary}
                </p>
              </div>
            )}

            <form action={submitApproveAndSend} className="mt-5">
              <input type="hidden" name="sheet_id" value={sheetId} />
              <button
                type="submit"
                className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {isSentToMd
                  ? "Re-send approval to MD"
                  : "Approve & send to Managing Director"}
              </button>
            </form>
          </div>
        </>
      )}
    </AppShell>
  );
}
