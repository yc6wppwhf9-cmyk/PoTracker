import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { EscalationsView } from "@/components/escalations-view";
import { notifyMdEscalations } from "@/lib/notify";

export default async function MdDashboardPage() {
  const profile = await requireRole("md", "admin");
  const supabase = await createClient();

  // pg_cron marks an overdue escalation `md_escalated` but cannot reach the
  // API to send mail, so the sweep runs here. It is idempotent — already
  // notified escalations are recorded in audit_log — so a page load is safe.
  await notifyMdEscalations();

  // Fetch approvals sent to MD with sheet details
  const { data: approvals } = await supabase
    .from("approval")
    .select(`
      id,
      rm_sheet_id,
      sent_to_md_at,
      md_decision,
      md_summary,
      rm_sheet (
        id,
        style_ref,
        status,
        created_at
      )
    `)
    .not("sent_to_md_at", "is", null)
    .order("sent_to_md_at", { ascending: false });

  const rows = approvals ?? [];
  const pending = rows.filter((r) => r.md_decision === "pending");
  const history = rows.filter((r) => r.md_decision !== "pending");

  return (
    <AppShell profile={profile}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Managing Director Dashboard
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Review and grant final approval for reconciled Raw Material purchase orders.
          </p>
        </div>
      </div>

      {/* Metrics overview */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-black/[0.08] bg-white p-5 dark:border-white/[0.08] dark:bg-neutral-900">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Pending Decision
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
            {pending.length}
          </div>
          <div className="mt-0.5 text-xs text-neutral-400">Requires your sign-off</div>
        </div>

        <div className="rounded-xl border border-black/[0.08] bg-white p-5 dark:border-white/[0.08] dark:bg-neutral-900">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            Approved POs
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
            {history.filter((h) => h.md_decision === "approved").length}
          </div>
          <div className="mt-0.5 text-xs text-neutral-400">Approved by MD</div>
        </div>

        <div className="rounded-xl border border-black/[0.08] bg-white p-5 dark:border-white/[0.08] dark:bg-neutral-900">
          <div className="text-xs font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
            Rejected POs
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
            {history.filter((h) => h.md_decision === "rejected").length}
          </div>
          <div className="mt-0.5 text-xs text-neutral-400">Rejected by MD</div>
        </div>
      </div>

      {/* Pending approvals section */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">
          Pending MD Approvals ({pending.length})
        </h2>

        <div className="mt-3 overflow-hidden rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-white/[0.06]">
              <tr>
                <th className="px-4 py-3 font-medium">Sheet Ref</th>
                <th className="px-4 py-3 font-medium">Executive Summary</th>
                <th className="px-4 py-3 font-medium">Sent Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const sheet = (Array.isArray(r.rm_sheet) ? r.rm_sheet[0] : r.rm_sheet) as {
                  id: string;
                  style_ref: string | null;
                  status: string;
                } | null;

                return (
                  <tr
                    key={r.id}
                    className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
                  >
                    <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                      {sheet?.style_ref ?? `Sheet ${r.rm_sheet_id.slice(0, 8)}`}
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs text-neutral-600 line-clamp-2 dark:text-neutral-400">
                      {r.md_summary || "Reconciliation review pending."}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">
                      {r.sent_to_md_at ? new Date(r.sent_to_md_at).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/procurement/md/${r.rm_sheet_id}`}
                        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                      >
                        Review & Decide
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                    No pending approval requests for MD.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auto-escalated items (SLA breached) — live via realtime */}
      <EscalationsView mode="md" title="Auto-escalated to you (9h SLA passed)" />

      {/* Decision history section */}
      {history.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">
            Decision History
          </h2>

          <div className="mt-3 overflow-hidden rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
            <table className="w-full text-sm">
              <thead className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-white/[0.06]">
                <tr>
                  <th className="px-4 py-3 font-medium">Sheet Ref</th>
                  <th className="px-4 py-3 font-medium">MD Decision</th>
                  <th className="px-4 py-3 font-medium">Summary</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const sheet = (Array.isArray(r.rm_sheet) ? r.rm_sheet[0] : r.rm_sheet) as {
                    id: string;
                    style_ref: string | null;
                  } | null;

                  return (
                    <tr
                      key={r.id}
                      className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
                    >
                      <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                        {sheet?.style_ref ?? `Sheet ${r.rm_sheet_id.slice(0, 8)}`}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                            r.md_decision === "approved"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                          }`}
                        >
                          {r.md_decision}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-neutral-500 truncate">
                        {r.md_summary}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">
                        {r.sent_to_md_at ? new Date(r.sent_to_md_at).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/procurement/md/${r.rm_sheet_id}`}
                          className="text-xs font-medium text-neutral-600 hover:underline dark:text-neutral-400"
                        >
                          View Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
