import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  STATUS_META,
  STATUS_ORDER,
  statusVar,
  type ReconRow,
} from "@/lib/reconciliation";
import { ReconTabs } from "@/components/recon/recon-tabs";
import { submitMdDecision } from "../actions";

export default async function MdSheetDetailPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("md", "admin");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at, uploaded_by")
    .eq("id", sheetId)
    .limit(1);
  const sheet = sheetRows?.[0];
  if (!sheet) notFound();

  const { data: approvalRows } = await supabase
    .from("approval")
    .select("*")
    .eq("rm_sheet_id", sheetId)
    .limit(1);
  const approval = approvalRows?.[0];

  // Paged — the MD's decision must not be based on a truncated view.
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

  const counts: Record<string, number> = {};
  for (const r of recon) if (r.status) counts[r.status] = (counts[r.status] ?? 0) + 1;

  // Fetch attached POs count
  const { count: poCount } = await supabase
    .from("po")
    .select("*", { count: "exact", head: true })
    .eq("rm_sheet_id", sheetId);

  return (
    <AppShell profile={profile}>
      <Link
        href="/procurement/md"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← Back to MD dashboard
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            MD Review: {sheet.style_ref ?? `Sheet ${sheet.id.slice(0, 8)}`}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Uploaded on {new Date(sheet.created_at).toLocaleString()} • {poCount ?? 0} PO document(s) generated
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium dark:bg-neutral-800">
            Sheet Status: {sheet.status}
          </span>
          {approval?.md_decision && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                approval.md_decision === "approved"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : approval.md_decision === "rejected"
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              MD Decision: {approval.md_decision}
            </span>
          )}
        </div>
      </div>



      {/* Executive Summary Card */}
      <div className="mt-6 rounded-2xl border border-black/[0.08] bg-white p-6 dark:border-white/[0.08] dark:bg-neutral-900">
        <h2 className="text-lg font-semibold tracking-tight">
          Executive Summary for Managing Director
        </h2>
        <div className="mt-3 rounded-xl border border-black/[0.06] bg-neutral-50 p-4 dark:border-white/[0.06] dark:bg-neutral-800/50">
          <p className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
            {approval?.md_summary || "No executive summary available for this sheet."}
          </p>
        </div>

        {/* Decision Actions */}
        {approval ? (
          <div className="mt-6 border-t border-black/[0.06] pt-6 dark:border-white/[0.06]">
            <h3 className="text-sm font-semibold tracking-wide uppercase text-neutral-500">
              Managing Director Action
            </h3>
            <div className="mt-4 flex flex-wrap gap-4">
              <form action={submitMdDecision}>
                <input type="hidden" name="approval_id" value={approval.id} />
                <input type="hidden" name="decision" value="approved" />
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  ✓ Approve Purchase Orders
                </button>
              </form>

              <form action={submitMdDecision}>
                <input type="hidden" name="approval_id" value={approval.id} />
                <input type="hidden" name="decision" value="rejected" />
                <button
                  type="submit"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
                >
                  ✕ Reject Purchase Orders
                </button>
              </form>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-neutral-400">
            This sheet has not been formally submitted by an approver yet.
          </p>
        )}
      </div>

      {/* Item reconciliation detailed table */}
      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Item Reconciliation Detail
        </h2>
        {recon.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            No lines reconciled yet.
          </p>
        ) : (
          <ReconTabs rows={recon} />
        )}
      </div>
    </AppShell>
  );
}
