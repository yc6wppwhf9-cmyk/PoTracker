import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { SheetTable } from "./sheet-table";

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

      <SheetTable
        sheets={(sheets ?? []).map((s) => {
          const a = approvalBySheet.get(s.id);
          return {
            id: s.id,
            style_ref: s.style_ref,
            status: s.status,
            created_at: s.created_at,
            sentToMdAt: a?.sent_to_md_at ?? null,
            mdDecision: a?.md_decision ?? null,
          };
        })}
      />
    </AppShell>
  );
}
