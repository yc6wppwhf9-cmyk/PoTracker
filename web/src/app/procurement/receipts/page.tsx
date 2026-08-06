import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getReceipts } from "@/lib/receipts";
import { getOverReceipts } from "@/lib/over-receipts";
import { ReceiptsTable } from "@/components/recon/receipts-table";
import { DownloadButton } from "@/app/procurement/approver/download-button";
import { FetchStatus } from "./fetch-status";
import { ManualImport } from "./manual-import";

/**
 * The GRN register — one screen, not two.
 *
 * There was a separate import screen, from when a person had to load the file.
 * The mailbox fetch does that every five minutes now, so importing is no longer
 * a task somebody comes here to do; it is a fallback for when the automation
 * cannot, which is why it sits behind a disclosure rather than at the top.
 */
export default async function ReceiptsPage() {
  const profile = await requireRole("approver", "purchase_head", "md", "po_team");

  const receipts = await getReceipts();
  const over = await getOverReceipts();

  // Writing is narrower than reading: the approver and MD review what arrived,
  // they do not load it. RLS enforces this independently of the UI.
  const canImport = ["po_team", "purchase_head", "admin"].includes(profile.role);

  const overValue = over.reduce((t, l) => t + (l.excessValue ?? 0), 0);
  const surplus = over.filter((l) => (l.vsRequired ?? 0) > 0).length;

  return (
    <AppShell profile={profile}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            GRN register
            {over.length > 0 && (
              <span className="ml-2 rounded-full bg-rose-100 px-2.5 py-0.5 text-sm font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                {over.length}
              </span>
            )}
          </h1>
          <p className="mt-1 max-w-3xl text-neutral-500">
            What arrived, beside what each line was ordered against. Collected
            automatically from the register emailed by the ERP.
          </p>
        </div>
        <DownloadButton
          path="/exports/grn-register.xlsx"
          filename="grn-register.xlsx"
          label="Download register"
        />
      </div>

      <FetchStatus />

      {/* The money first: an excess is the reason to read the table, not
          something to be discovered inside it. */}
      {over.length > 0 && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <strong>{over.length} line(s)</strong> received more than the purchase
          order asked for
          {overValue > 0 && (
            <>
              , excess worth{" "}
              <strong className="tabular-nums">
                {overValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </strong>
            </>
          )}
          . {surplus} of them leave more than the sheet required; the rest fill a
          shortfall.
        </p>
      )}

      <ReceiptsTable rows={receipts} />

      {canImport && <ManualImport />}
    </AppShell>
  );
}
