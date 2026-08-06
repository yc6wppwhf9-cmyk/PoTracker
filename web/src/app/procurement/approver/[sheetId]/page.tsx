import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { type ReconRow } from "@/lib/reconciliation";
import { ReconTabs } from "@/components/recon/recon-tabs";
import { EscalationPanel } from "./escalation-panel";
import { ExportButton } from "@/components/recon/export-button";
import { formatDateTime } from "@/lib/format";

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
            Uploaded on {formatDateTime(sheet.created_at)}
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



      {/* Approving happens per purchase order on /procurement/po-approvals,
          not per sheet. A sheet becomes many POs to many suppliers, so
          "approve the sheet" said nothing about which order was agreed to —
          and the approver is now final, so there is nothing to send onward. */}
      <div className="mt-6 rounded-2xl border border-black/[0.08] bg-white px-5 py-4 text-sm dark:border-white/[0.08] dark:bg-neutral-900">
        <span className="text-neutral-500">
          Purchase orders raised from this sheet are approved individually.
        </span>{" "}
        <Link
          href="/procurement/po-approvals"
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Go to PO approvals →
        </Link>
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
