import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getReceipts } from "@/lib/receipts";
import { ReceiptsTable } from "@/components/recon/receipts-table";

/**
 * What actually arrived against this buyer's own purchase orders.
 *
 * Not the approver's GRN register with a role added: that screen carries the
 * mailbox fetch status, the manual import and the over-receipt review, none of
 * which is the buyer's job. This is the read they need — did my material come
 * in? — and nothing else.
 *
 * The rows are scoped by RLS rather than by a filter here: grn_select lets a
 * buyer see receipts matching a PO number they raised, so there is no way for
 * this page to show another buyer's deliveries even by mistake.
 */
export default async function MyReceiptsPage() {
  const profile = await requireRole("buyer");
  const receipts = await getReceipts();

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">My receipts</h1>
      <p className="mb-6 mt-1 max-w-3xl text-neutral-500">
        Goods received against purchase orders you raised, taken from the
        register the ERP emails in. Each line shows what arrived beside what it
        was ordered against.
      </p>

      {receipts.length === 0 ? (
        <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
          Nothing received yet against your purchase orders. Receipts appear
          here once the PO number has been captured on the document and the
          register naming it has been imported.
        </p>
      ) : (
        <ReceiptsTable rows={receipts} />
      )}
    </AppShell>
  );
}
