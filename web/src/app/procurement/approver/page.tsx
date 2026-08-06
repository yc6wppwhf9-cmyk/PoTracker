import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getPendingPos } from "@/lib/pending-pos";
import { PendingPos } from "./pending-pos";
import { getOverReceipts } from "@/lib/over-receipts";
import { OverReceipts } from "./over-receipts";
import { ApproverTabs } from "./tabs";

/** A sheet still needing the approver's decision, as opposed to one already
 *  sent to the MD or decided. */
const AWAITING = new Set(["uploaded", "assigned", "reconciled", "in_review"]);

export default async function ApproverList() {
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

  // Outstanding purchase orders, derived from the GRN register rather than a
  // stored status, so the list cannot drift out of step with what has arrived.
  const pending = await getPendingPos();

  // The mirror case: goods that arrived in excess of the order. Nothing earlier
  // in the chain can catch it — at PO time the numbers were right.
  const overReceipts = await getOverReceipts();

  // Recent receipts, so the approver can see what the two lists above are
  // derived from without being sent to another screen.
  const receipts = await fetchAll<{
    grc_no: string;
    grc_date: string | null;
    po_number: string | null;
    item_code: string | null;
    lot: string | null;
    qty: number;
    supplier: string | null;
  }>((from, to) =>
    supabase
      .from("grn")
      .select("grc_no, grc_date, po_number, item_code, lot, qty, supplier")
      .order("grc_date", { ascending: false })
      .range(from, Math.min(to, 199))
  );

  const awaiting = (sheets ?? []).filter((s) => {
    const a = approvalBySheet.get(s.id);
    return !a?.sent_to_md_at && AWAITING.has(s.status);
  });

  const sheetsPanel = (
    <>
      <p className="mb-3 text-sm text-neutral-500">
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
    </>
  );

  const pendingPanel = (
    <>
      <p className="mb-3 text-sm text-neutral-500">
        Material still outstanding against a purchase order, measured from the
        imported GRN register. Overdue first; part-received orders are shown
        whether or not their date has passed.
      </p>
      <PendingPos pos={pending} />
    </>
  );

  const grnPanel = (
    <>
      <div className="mb-6">
        <h3 className="text-base font-semibold tracking-tight">
          Over-received
          {overReceipts.length > 0 && (
            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {overReceipts.length}
            </span>
          )}
        </h3>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          More material arrived than the purchase order asked for. The order may
          have been correct — this is what the supplier actually delivered.
        </p>
        <OverReceipts lines={overReceipts} />
      </div>

      <h3 className="text-base font-semibold tracking-tight">
        Receipts
        <span className="ml-2 text-sm font-normal text-neutral-500">
          {receipts.length >= 200 ? "latest 200" : `${receipts.length} line(s)`}
        </span>
      </h3>
      <p className="mb-3 mt-1 text-sm text-neutral-500">
        What the GRN register recorded as arriving. Read-only here — importing is
        the PO team&apos;s.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">GRC</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">PO number</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Lot</th>
              <th className="px-4 py-3 text-right font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r, i) => (
              <tr
                key={`${r.grc_no}-${r.item_code ?? ""}-${i}`}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3 font-mono text-xs">{r.grc_no}</td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                  {r.grc_date ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {r.po_number ?? <span className="font-sans text-neutral-400">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{r.item_code ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-500">{r.lot ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {Number(r.qty).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                  {r.supplier ?? "—"}
                </td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  No receipts imported yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="mb-6 mt-1 text-neutral-500">
        Sheets awaiting your decision, and what has happened to the orders
        raised against them.
      </p>

      <ApproverTabs
        tabs={[
          {
            key: "sheets",
            label: "MR sheets to approve",
            count: awaiting.length,
            content: sheetsPanel,
          },
          {
            key: "pending",
            label: "Pending POs",
            count: pending.length,
            alert: pending.some((p) => p.overdue),
            content: pendingPanel,
          },
          {
            key: "grn",
            label: "GRN register",
            count: overReceipts.length,
            alert: overReceipts.length > 0,
            content: grnPanel,
          },
        ]}
      />
    </AppShell>
  );
}
