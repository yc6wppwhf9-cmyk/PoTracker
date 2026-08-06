import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getPoApprovals } from "@/lib/po-approvals";
import { PoList } from "./po-list";

export default async function PoApprovalsPage() {
  const profile = await requireRole("approver");
  const pos = await getPoApprovals();

  const pending = pos.filter((p) => p.approvalStatus !== "approved");
  const escalated = pending.filter((p) => p.escalation).length;

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">
        PO approvals
        {pending.length > 0 && (
          <span className="ml-2 rounded-full bg-indigo-100 px-2.5 py-0.5 text-sm font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            {pending.length}
          </span>
        )}
      </h1>
      <p className="mb-6 mt-1 max-w-3xl text-neutral-500">
        Approve each purchase order, or escalate it to the buyer who raised it.
        You are the final approver — only escalations reach the Managing
        Director. Received quantities come from the imported GRN register.
        {escalated > 0 && (
          <>
            {" "}
            <strong className="text-amber-700 dark:text-amber-400">
              {escalated} awaiting an answer from a buyer.
            </strong>
          </>
        )}
      </p>

      <PoList pos={pos} />
    </AppShell>
  );
}
