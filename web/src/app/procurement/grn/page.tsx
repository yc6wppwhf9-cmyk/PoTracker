import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { GrnImportForm } from "./import-form";

export default async function GrnPage() {
  const profile = await requireRole("po_team", "purchase_head");
  const supabase = await createClient();

  // Recent receipts, so an import can be seen to have landed rather than
  // taken on trust from a success message.
  const { data: recent } = await supabase
    .from("grn")
    .select("grc_no, grc_date, po_number, item_code, lot, qty, supplier, imported_at")
    .order("imported_at", { ascending: false })
    .limit(50);

  const { count: total } = await supabase
    .from("grn")
    .select("id", { count: "exact", head: true });

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">GRN register</h1>
      <p className="mt-1 max-w-3xl text-neutral-500">
        Import the GRC export to record what has actually arrived. Receipts are
        matched to purchase orders by PO number, barcode and lot, and drive the
        approver&apos;s pending-PO list.
      </p>

      <div className="mt-6 rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-neutral-900">
        <GrnImportForm />
        {/* Stated up front because the instinct with a monthly export is to
            worry about importing twice. */}
        <p className="mt-4 max-w-3xl text-xs text-neutral-500">
          Re-importing is safe. Every GRC number in the file replaces its
          existing lines, so a corrected register overwrites rather than adds,
          and GRC numbers absent from the file are left untouched.
        </p>
      </div>

      <h2 className="mt-10 text-lg font-semibold tracking-tight">
        Recent receipts
        {typeof total === "number" && (
          <span className="ml-2 text-sm font-normal text-neutral-500">
            {total.toLocaleString()} line(s) in total
          </span>
        )}
      </h2>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
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
            {(recent ?? []).map((r, i) => (
              <tr
                key={`${r.grc_no}-${r.item_code ?? ""}-${r.lot ?? ""}-${i}`}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3 font-mono text-xs">{r.grc_no}</td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                  {r.grc_date ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {r.po_number ?? (
                    <span className="font-sans text-neutral-400">—</span>
                  )}
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
            {(!recent || recent.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  No receipts imported yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
