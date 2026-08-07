import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getSupplierOrders } from "@/lib/supplier-orders";
import { SupplierList } from "./supplier-list";

/**
 * Open orders arranged by supplier, because that is how chasing happens: one
 * call covers everything outstanding with one party.
 *
 * A buyer sees their own orders; the purchase head and approver see all of
 * them, since they answer for the delay across buyers.
 */
export default async function SupplierOrdersPage() {
  const profile = await requireRole("buyer", "purchase_head", "approver", "md");
  const mine = profile.role === "buyer";
  const groups = await getSupplierOrders(mine ? profile.userId : undefined);

  const late = groups.filter((g) => g.worstOverdue > 0).length;

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">
        Open orders by supplier
      </h1>
      <p className="mb-6 mt-1 max-w-3xl text-neutral-500">
        Everything still outstanding with each supplier
        {mine ? " on orders you raised" : ""}, so one call covers all of it.
        Worst overdue first.{" "}
        {late > 0 && (
          <strong className="text-rose-700 dark:text-rose-400">
            {late} supplier(s) are past an ETD.
          </strong>
        )}
      </p>

      <SupplierList groups={groups} />
    </AppShell>
  );
}
