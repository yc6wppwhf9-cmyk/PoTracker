import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getPendingPos } from "@/lib/pending-pos";
import { PendingPos } from "./pending-pos";
import { getOverReceipts } from "@/lib/over-receipts";
import { ApproverTabs } from "./tabs";
import { DownloadButton } from "./download-button";

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
      <PendingPos lines={pending} />
    </>
  );

  // Ordered and received per (PO number, item), so each receipt row carries the
  // comparison instead of making the reader find it in a second table.
  const key = (po: string | null, code: string | null) =>
    `${(po ?? "").toUpperCase()}__${(code ?? "").toUpperCase()}`;

  const orderedBy = new Map<string, number>();
  const receivedBy = new Map<string, number>();
  const receiptPoNumbers = [
    ...new Set(receipts.map((r) => r.po_number).filter(Boolean)),
  ] as string[];

  if (receiptPoNumbers.length > 0) {
    const { data: matched } = await supabase
      .from("po")
      .select("po_number, po_line(item_code, ordered_qty)")
      .in("po_number", receiptPoNumbers)
      .neq("status", "draft");
    for (const p of matched ?? [])
      for (const l of (p.po_line as unknown as {
        item_code: string | null;
        ordered_qty: number;
      }[]) ?? []) {
        const k = key(p.po_number, l.item_code);
        orderedBy.set(k, (orderedBy.get(k) ?? 0) + (Number(l.ordered_qty) || 0));
      }
    for (const r of receipts) {
      const k = key(r.po_number, r.item_code);
      receivedBy.set(k, (receivedBy.get(k) ?? 0) + (Number(r.qty) || 0));
    }
  }

  const overValue = overReceipts.reduce((t, l) => t + (l.excessValue ?? 0), 0);
  const genuineSurplus = overReceipts.filter((l) => (l.vsRequired ?? 0) > 0).length;

  const grnPanel = (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-neutral-500">
          What the GRN register recorded as arriving, with what each line was
          ordered against. Read-only here — importing is the PO team&apos;s.
        </p>
        <DownloadButton
          path="/exports/grn-register.xlsx"
          filename="grn-register.xlsx"
          label="Download register"
        />
      </div>

      {/* The headline first: an excess is money, and it is the reason to read
          the table rather than something to be found inside it. */}
      {overReceipts.length > 0 && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <strong>{overReceipts.length} line(s)</strong> received more than the
          purchase order asked for
          {overValue > 0 && (
            <>
              , excess worth{" "}
              <strong className="tabular-nums">
                {overValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </strong>
            </>
          )}
          . {genuineSurplus} of them leave more than the sheet required; the rest
          fill a shortfall.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">GRC</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">PO number</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Lot</th>
              <th className="px-4 py-3 text-right font-medium">This receipt</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Received</th>
              <th className="px-4 py-3 text-right font-medium">Excess</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r, i) => {
              const k = key(r.po_number, r.item_code);
              const ordered = orderedBy.get(k) ?? null;
              const received = receivedBy.get(k) ?? (Number(r.qty) || 0);
              // 2% throughout: deliveries are rarely exact, and flagging every
              // rounding difference trains people to ignore the column.
              const excess =
                ordered != null && ordered > 0 && received > ordered * 1.02
                  ? received - ordered
                  : null;
              return (
                <tr
                  key={`${r.grc_no}-${r.item_code ?? ""}-${i}`}
                  className={`border-b border-black/5 last:border-0 dark:border-white/5 ${
                    excess != null ? "bg-rose-50/60 dark:bg-rose-950/20" : ""
                  }`}
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
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                    {ordered == null ? (
                      <span title="No purchase order in this system carries that PO number and item. Usually the PO was raised elsewhere, or its number was never captured from the attached document.">
                        no match
                      </span>
                    ) : (
                      ordered.toLocaleString()
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {received.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {excess == null ? (
                      <span className="text-neutral-300">—</span>
                    ) : (
                      <span className="font-semibold text-rose-700 dark:text-rose-400">
                        +{excess.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                    {r.supplier ?? "—"}
                  </td>
                </tr>
              );
            })}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-neutral-500">
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
