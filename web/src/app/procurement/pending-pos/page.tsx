import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getPendingPos } from "@/lib/pending-pos";
import { PendingPos } from "@/app/procurement/approver/pending-pos";

/**
 * Its own screen rather than a tab: this is a standing worklist somebody
 * returns to, not a step inside approving one sheet.
 *
 * Open to the roles that chase a supplier or answer for the delay — the
 * purchase head owns the buyers, the MD sees it when an escalation reaches
 * them.
 */
export default async function PendingPosPage() {
  const profile = await requireRole("approver", "purchase_head", "md");
  const lines = await getPendingPos();

  const overdue = lines.filter((l) => l.overdue).length;
  const outstanding = lines.reduce((s, l) => s + l.outstanding, 0);

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">
        Pending POs
        {lines.length > 0 && (
          <span
            className={`ml-2 rounded-full px-2.5 py-0.5 text-sm font-semibold ${
              overdue > 0
                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            }`}
          >
            {lines.length}
          </span>
        )}
      </h1>
      <p className="mb-6 mt-1 max-w-3xl text-neutral-500">
        Material still outstanding against a purchase order, measured from the
        imported GRN register.{" "}
        {overdue > 0 && (
          <>
            <strong className="text-rose-700 dark:text-rose-400">
              {overdue} line(s) are past their ETD
            </strong>
            .{" "}
          </>
        )}
        {outstanding > 0 && (
          <>
            {outstanding.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            outstanding in total.
          </>
        )}
      </p>

      <PendingPos lines={lines} />
    </AppShell>
  );
}
