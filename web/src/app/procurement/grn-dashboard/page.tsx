import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getGrnKpis } from "@/lib/grn-kpis";

/**
 * A read-only overview of goods receipt, for the roles that oversee purchasing
 * rather than work a single register.
 *
 * The detail already lives on three screens — the GRN register, the pending-PO
 * list, and the over-receipt flag inside the register. This gathers the
 * headline of each into one set of tiles so the admin, approver and MD can see
 * the state of receiving at a glance, then click through to whichever list
 * needs acting on.
 */
export default async function GrnDashboardPage() {
  const profile = await requireRole("approver", "md");
  const k = await getGrnKpis();

  const n = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // Grouped so the eye reads them as three questions: what has arrived, what is
  // over, and what is still owed.
  const groups: {
    title: string;
    tone: "neutral" | "rose" | "amber";
    href?: string;
    linkLabel?: string;
    tiles: { label: string; value: string; hint?: string }[];
  }[] = [
    {
      title: "Received",
      tone: "neutral",
      href: "/procurement/receipts",
      linkLabel: "Open GRN register",
      tiles: [
        { label: "Receipt lines", value: n(k.receipts) },
        { label: "POs received against", value: n(k.posReceived) },
        { label: "Last 7 days", value: n(k.receivedLast7), hint: "new lines" },
        { label: "Quantity received", value: n(k.qtyReceived) },
        ...(k.valueReceived > 0
          ? [{ label: "Value received", value: n(k.valueReceived), hint: "landed cost" }]
          : []),
      ],
    },
    {
      title: "Over-delivered",
      tone: "rose",
      href: "/procurement/receipts",
      linkLabel: "Review excess",
      tiles: [
        { label: "Excess lines", value: n(k.overLines) },
        ...(k.overExcessValue > 0
          ? [{ label: "Excess value", value: n(k.overExcessValue) }]
          : []),
      ],
    },
    {
      title: "Outstanding",
      tone: "amber",
      href: "/procurement/pending-pos",
      linkLabel: "Chase pending POs",
      tiles: [
        { label: "Outstanding lines", value: n(k.outstandingLines) },
        { label: "Past ETD", value: n(k.overdueLines), hint: "overdue" },
        { label: "Nothing received", value: n(k.nothingReceivedLines), hint: "not started" },
      ],
    },
  ];

  const accent: Record<"neutral" | "rose" | "amber", string> = {
    neutral: "text-indigo-600 dark:text-indigo-400",
    rose: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
  };

  return (
    <AppShell profile={profile}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">GRN dashboard</h1>
        <p className="mt-1 max-w-3xl text-neutral-500">
          The state of goods receipt at a glance — what has arrived, what came in
          over the order, and what is still owed. Collected automatically from the
          register emailed by the ERP.
        </p>
      </div>

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {g.title}
              </h2>
              {g.href && (
                <Link
                  href={g.href}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                >
                  {g.linkLabel} →
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {g.tiles.map((t) => (
                <div
                  key={t.label}
                  className="glass-card relative overflow-hidden rounded-2xl p-5"
                >
                  <div
                    className={`text-xs font-bold uppercase tracking-wider ${accent[g.tone]}`}
                  >
                    {t.label}
                  </div>
                  <div className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-white">
                    {t.value}
                  </div>
                  {t.hint && (
                    <div className="mt-1 text-xs font-medium text-slate-400">
                      {t.hint}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
