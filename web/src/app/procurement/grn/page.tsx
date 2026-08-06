import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { GrnImportForm } from "./import-form";
import { fetchAll } from "@/lib/supabase/fetch-all";

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

  // A receipt on its own says nothing — 3,085 arrived is only meaningful
  // against what was ordered. Ordered comes from the PO, and received is the
  // running total across every receipt for that line, not just this one.
  const recentRows = recent ?? [];
  const poNumbers = [
    ...new Set(recentRows.map((r) => r.po_number).filter(Boolean)),
  ] as string[];

  // Lot is deliberately not part of the key: the register and the RM sheet
  // name lots from different systems, so requiring them to agree meant a
  // receipt never matched its order. See lib/pending-pos.ts.
  const key = (po: string | null, code: string | null) =>
    `${(po ?? "").toUpperCase()}__${(code ?? "").toUpperCase()}`;

  const orderedBy = new Map<string, number>();
  const receivedBy = new Map<string, number>();

  if (poNumbers.length > 0) {
    const { data: pos } = await supabase
      .from("po")
      .select("po_number, po_line(item_code, lot, ordered_qty)")
      .in("po_number", poNumbers)
      .neq("status", "draft");
    for (const p of pos ?? [])
      for (const l of (p.po_line as unknown as {
        item_code: string | null;
        lot: string | null;
        ordered_qty: number;
      }[]) ?? []) {
        const k = key(p.po_number, l.item_code);
        orderedBy.set(k, (orderedBy.get(k) ?? 0) + (Number(l.ordered_qty) || 0));
      }

    // Paged: a truncated read would understate the running total and hide an
    // excess behind an apparently normal figure.
    const all = await fetchAll<{
      po_number: string | null;
      item_code: string | null;
      lot: string | null;
      qty: number;
    }>((from, to) =>
      supabase
        .from("grn")
        .select("po_number, item_code, lot, qty")
        .in("po_number", poNumbers)
        .order("id")
        .range(from, to)
    );
    for (const g of all) {
      const k = key(g.po_number, g.item_code);
      receivedBy.set(k, (receivedBy.get(k) ?? 0) + (Number(g.qty) || 0));
    }
  }

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">GRN register</h1>
      <p className="mt-1 max-w-3xl text-neutral-500">
        Import the GRC export to record what has actually arrived. Receipts are
        matched to purchase orders by PO number and barcode, and drive the
        approver&apos;s open-PO and over-received lists.
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
              <th className="px-4 py-3 text-right font-medium">This receipt</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Received</th>
              <th className="px-4 py-3 text-right font-medium">Excess</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
            </tr>
          </thead>
          <tbody>
            {recentRows.map((r, i) => {
              const k = key(r.po_number, r.item_code);
              const ordered = orderedBy.get(k) ?? null;
              const received = receivedBy.get(k) ?? (Number(r.qty) || 0);
              // 2% matches the approver's view: deliveries are rarely exact and
              // flagging every rounding difference trains people to ignore it.
              const excess =
                ordered != null && received > ordered * 1.02
                  ? received - ordered
                  : null;
              return (
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
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                  {ordered == null ? (
                    <span title="No purchase order in this system carries that PO number and barcode. Usually the PO was raised elsewhere, or its number was never captured from the attached document.">
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
            {recentRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-neutral-500">
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
