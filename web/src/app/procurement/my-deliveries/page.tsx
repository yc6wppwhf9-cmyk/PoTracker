import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getPendingPos } from "@/lib/pending-pos";
import { PendingPos } from "@/app/procurement/approver/pending-pos";

/**
 * What the buyer is still waiting for.
 *
 * The same worklist the approver sees on /procurement/pending-pos, narrowed to
 * the orders this buyer raised. Separate route rather than a role added to
 * that one: the approver's list is a supervisory view of everybody, and the
 * buyer's is their own work. Sharing a URL would have meant the same link
 * meaning two different things depending on who clicked it.
 *
 * The buyer had no register at all before this — the person who has to phone
 * the supplier was the only role with no way to see what was late.
 */
export default async function MyDeliveriesPage() {
  const profile = await requireRole("buyer");
  const lines = await getPendingPos(profile.userId);

  const overdue = lines.filter((l) => l.overdue).length;
  const outstanding = lines.reduce((s, l) => s + l.outstanding, 0);

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">
        My pending deliveries
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
        Material still outstanding against purchase orders you raised, measured
        against the imported GRN register.{" "}
        {overdue > 0 && (
          <>
            <strong className="text-rose-700 dark:text-rose-400">
              {overdue} line(s) are past their ETD
            </strong>{" "}
            — these are the ones to chase.{" "}
          </>
        )}
        {outstanding > 0 && (
          <>
            {outstanding.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            outstanding in total.
          </>
        )}
      </p>

      {lines.length === 0 ? (
        <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
          Nothing outstanding. Every order you have sent has been received in
          full — or you have not sent one yet.
        </p>
      ) : (
        <PendingPos lines={lines} />
      )}
    </AppShell>
  );
}
