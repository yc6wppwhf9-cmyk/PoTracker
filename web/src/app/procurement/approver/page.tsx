import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

/** A sheet still needing the approver's decision, as opposed to one already
 *  sent to the MD or decided. */
const AWAITING = new Set(["uploaded", "assigned", "reconciled", "in_review"]);

export default async function ApproverSheets() {
  const profile = await requireRole("approver");
  const supabase = await createClient();

  const { data: sheets } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at")
    .order("created_at", { ascending: false });

  // Which sheets have already gone to the MD — the difference between "to
  // approve" and "already handled", which the sheet's own status does not say.
  const { data: approvals } = await supabase
    .from("approval")
    .select("rm_sheet_id, sent_to_md_at, md_decision");
  const approvalBySheet = new Map(
    (approvals ?? []).map((a) => [a.rm_sheet_id, a])
  );

  const awaiting = (sheets ?? []).filter((s) => {
    const a = approvalBySheet.get(s.id);
    return !a?.sent_to_md_at && AWAITING.has(s.status);
  });

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">
        MR sheets to approve
        {awaiting.length > 0 && (
          <span className="ml-2 rounded-full bg-indigo-100 px-2.5 py-0.5 text-sm font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            {awaiting.length}
          </span>
        )}
      </h1>
      <p className="mb-6 mt-1 text-neutral-500">
        Review the reconciliation for a sheet, then send it to the Managing
        Director.
      </p>

      <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-white/[0.06]">
            <tr>
              <th className="px-4 py-3 font-medium">Sheet</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Uploaded</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(sheets ?? []).map((s) => {
              const a = approvalBySheet.get(s.id);
              return (
                <tr
                  key={s.id}
                  className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
                >
                  <td className="px-4 py-3 font-medium">
                    {s.style_ref ?? `Sheet ${s.id.slice(0, 8)}`}
                  </td>
                  <td className="px-4 py-3">
                    {/* Where it stands with the MD matters more than the
                        sheet's own status, which says nothing about approval. */}
                    {a?.sent_to_md_at ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.md_decision === "approved"
                            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                            : a.md_decision === "rejected"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                        }`}
                      >
                        {a.md_decision === "pending"
                          ? "with the MD"
                          : `MD ${a.md_decision}`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                        {s.status}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/procurement/approver/${s.id}`}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                    >
                      {a?.sent_to_md_at ? "View" : "Review"}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {(!sheets || sheets.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  No sheets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
