import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { getPendingPos } from "@/lib/pending-pos";
import { PendingPos } from "./pending-pos";
import { getOverReceipts } from "@/lib/over-receipts";
import { OverReceipts } from "./over-receipts";

export default async function ApproverList() {
  const profile = await requireRole("approver");
  const supabase = await createClient();

  const { data: sheets } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at")
    .order("created_at", { ascending: false });

  // Overdue purchase orders, derived from the GRN register rather than a
  // stored status, so the list cannot drift out of step with what has arrived.
  const pending = await getPendingPos();

  // The mirror case: goods that arrived in excess of the order. Nothing
  // earlier in the chain can catch it — at PO time the numbers were right.
  const overReceipts = await getOverReceipts();

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="mt-1 text-neutral-500">
        Review reconciliation for each sheet, then send it to the Managing
        Director.
      </p>

      <div className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">
          Pending POs
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {pending.length}
            </span>
          )}
        </h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          Past their ETD with goods still outstanding, measured against the
          imported GRN register.
        </p>
        <PendingPos pos={pending} />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">
          Over-received
          {overReceipts.length > 0 && (
            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {overReceipts.length}
            </span>
          )}
        </h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          More material arrived than the purchase order asked for. The order may
          have been correct — this is what the supplier actually delivered.
        </p>
        <OverReceipts lines={overReceipts} />
      </div>

      <h2 className="mt-10 text-lg font-semibold tracking-tight">Sheets</h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
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
            {(sheets ?? []).map((s) => (
              <tr
                key={s.id}
                className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
              >
                <td className="px-4 py-3 font-medium">
                  {s.style_ref ?? `Sheet ${s.id.slice(0, 8)}`}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-500">
                  {new Date(s.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/procurement/approver/${s.id}`}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
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
