import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { type ReconRow } from "@/lib/reconciliation";
import { ReconTabs } from "@/components/recon/recon-tabs";
import { submitApproveAndSend } from "../actions";
import { EscalationPanel } from "./escalation-panel";
import { ExportButton } from "@/components/recon/export-button";

export default async function ApproverSheetDetailPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("approver", "admin");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at, uploaded_by")
    .eq("id", sheetId)
    .limit(1);
  const sheet = sheetRows?.[0];
  if (!sheet) notFound();

  // Paged — a truncated read under-reports every quantity on this page.
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

  const { data: approvalRows } = await supabase
    .from("approval")
    .select("*")
    .eq("rm_sheet_id", sheetId)
    .limit(1);
  const approval = approvalRows?.[0];

  const counts: Record<string, number> = {};
  for (const r of recon) if (r.status) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const isSentToMd = Boolean(approval?.sent_to_md_at);

  return (
    <AppShell profile={profile}>
      <Link
        href="/procurement/approver"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← Back to approvals
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Review: {sheet.style_ref ?? `Sheet ${sheet.id.slice(0, 8)}`}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Uploaded on {new Date(sheet.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium dark:bg-neutral-800">
            Status: {sheet.status}
          </span>
          {isSentToMd && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
              Sent to MD
            </span>
          )}
        </div>
      </div>



      {/* Approval card */}
      <div className="mt-6 rounded-2xl border border-black/[0.08] bg-white p-6 dark:border-white/[0.08] dark:bg-neutral-900">
        <h2 className="text-lg font-semibold tracking-tight">
          Approver Action
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Verify the reconciliation breakdown above. Submitting will send this PO package to the Managing Director for final sign-off.
        </p>

        {approval?.md_summary && (
          <div className="mt-4 rounded-xl border border-black/[0.06] bg-neutral-50 p-4 dark:border-white/[0.06] dark:bg-neutral-800/50">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Executive Summary Preview
            </div>
            <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
              {approval.md_summary}
            </p>
          </div>
        )}

        <form action={submitApproveAndSend} className="mt-6 flex items-center justify-between">
          <input type="hidden" name="sheet_id" value={sheetId} />
          <button
            type="submit"
            className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {isSentToMd ? "Re-send Approval to MD" : "Approve & Send to Managing Director"}
          </button>
        </form>
      </div>

      {/* Detailed line reconciliation. The standalone Reconciliation tab is
          gone, so the KPI export lives here — the approval stage is where it
          was wanted, and it was previously reachable only from that tab. */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Detailed Item Reconciliation
          </h2>
          {recon.length > 0 && <ExportButton sheetId={sheetId} />}
        </div>
        {recon.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            No items to display for this sheet.
          </p>
        ) : (
          <ReconTabs rows={recon} />
        )}
      </div>

      {/* Escalate flagged materials to their buyers */}
      <div className="mt-10">
        <EscalationPanel sheetId={sheetId} />
      </div>
    </AppShell>
  );
}
