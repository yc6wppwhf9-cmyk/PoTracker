import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PoForm, type AssignedItem } from "./po-form";
import { SendPoBtn, PoDetailsFields } from "./send-po-btn";
import { shortSite } from "@/lib/sites";

/** The supplier a draft is for; drafts are split one per supplier. */
function supplierOf(
  lines: { supplier?: string | null }[]
): string | null {
  const names = [...new Set(lines.map((l) => l.supplier?.trim()).filter(Boolean))];
  return names.length === 0 ? null : (names as string[]).join(", ");
}

export default async function BuyerSheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("buyer");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status")
    .eq("id", sheetId)
    .limit(1);
  const sheet = sheetRows?.[0];
  if (!sheet) notFound();

  // This buyer's assigned lines for the sheet, with catalogue detail.
  // Paged: a truncated read would hide orderable lines from the buyer, so the
  // PO they raise would under-order.
  const lines = await fetchAll((from, to) =>
    supabase
      .from("rm_requirement")
      .select("item_code, lot, location, required_qty, item_master(name, category)")
      .eq("rm_sheet_id", sheetId)
      .eq("assigned_buyer", profile.userId)
      .not("item_code", "is", null)
      .order("id")
      .range(from, to)
  );

  // Aggregate per (item_code, lot, plant) — each is a separate orderable line so
  // a PO is traceable to its lot and plant.
  const agg = new Map<string, AssignedItem>();
  for (const l of lines) {
    const im = l.item_master as
      | { name?: string; category?: string }
      | null;
    const code = l.item_code as string;
    const lot = (l.lot as string | null) ?? null;
    const location = (l.location as string | null) ?? null;
    const key = `${code}__${lot ?? ""}__${location ?? ""}`;
    const cur =
      agg.get(key) ??
      ({
        item_code: code,
        lot,
        location,
        name: im?.name ?? code,
        category: im?.category ?? "—",
        required_qty: 0,
      } as AssignedItem);
    cur.required_qty += Number(l.required_qty) || 0;
    agg.set(key, cur);
  }
  const items = [...agg.values()].sort(
    (a, b) =>
      (a.location ?? "").localeCompare(b.location ?? "") ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name) ||
      (a.lot ?? "").localeCompare(b.lot ?? "")
  );
  items.forEach((i) => (i.required_qty = Math.round(i.required_qty * 100) / 100));

  // Existing POs this buyer created for the sheet, with their line items.
  const { data: pos } = await supabase
    .from("po")
    .select(
      "id, status, created_at, doc_path, etd, site, po_number, po_line(item_code, lot, location, ordered_qty, supplier, remark, item_master(name))"
    )
    .eq("rm_sheet_id", sheetId)
    .eq("created_by", profile.userId)
    .order("created_at", { ascending: false });

  return (
    <AppShell profile={profile}>
      <Link
        href="/procurement/buyer"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← Your sheets
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {sheet.style_ref ?? `Sheet ${sheet.id.slice(0, 8)}`}
      </h1>
      <p className="mt-1 text-neutral-500">
        {items.length} item(s) assigned to you. Select the items you are
        ordering, then record the supplier and rate for each.
      </p>

      <div className="mt-6">
        {items.length === 0 ? (
          <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            No items assigned to you on this sheet.
          </p>
        ) : (
          <PoForm sheetId={sheetId} items={items} />
        )}
      </div>

      {pos && pos.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Your POs for this sheet
          </h2>
          <div className="mt-3 space-y-3">
            {pos.map((p) => {
              const poLines =
                (p.po_line as unknown as {
                  item_code: string | null;
                  lot: string | null;
                  location: string | null;
                  ordered_qty: number;
                  supplier: string | null;
                  remark: string | null;
                  item_master: { name?: string } | null;
                }[]) ?? [];
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex items-center gap-3">
                      {/* Shows the supplier-facing number once the PO team
                          has attached the document it comes from. */}
                      <span className="font-mono text-xs">
                        {p.po_number ?? p.id.slice(0, 8)}
                      </span>
                      <span className="font-medium">
                        {supplierOf(poLines) ?? "No supplier set"}
                      </span>
                      <span className="text-neutral-500">
                        {poLines.length} line(s)
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.status === "draft"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-neutral-100 dark:bg-neutral-800"
                        }`}
                      >
                        {p.status === "draft" ? "draft — not sent" : p.status}
                      </span>
                      {p.doc_path ? "📎 doc" : "—"}
                      {p.status !== "draft" && (
                        <span className="text-xs text-neutral-500">
                          {p.etd ? `ETD ${p.etd}` : "no ETD"} ·{" "}
                          {shortSite(p.site)}
                        </span>
                      )}
                      {p.status === "draft" && (
                        <SendPoBtn
                          poId={p.id}
                          supplier={supplierOf(poLines)}
                          lineCount={poLines.length}
                        />
                      )}
                    </span>
                  </div>
                  {p.status === "draft" && (
                    <div className="border-t border-black/5 px-4 py-2 dark:border-white/5">
                      <PoDetailsFields poId={p.id} etd={p.etd} site={p.site} />
                    </div>
                  )}
                  <details className="group border-t border-black/5 dark:border-white/5">
                    <summary className="cursor-pointer list-none px-4 py-2 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                      <span className="group-open:hidden">▸ View items</span>
                      <span className="hidden group-open:inline">▾ Hide items</span>
                    </summary>
                    <div className="overflow-x-auto px-2 pb-3">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">Item</th>
                            <th className="px-3 py-2 font-medium">Code</th>
                            <th className="px-3 py-2 font-medium">Plant</th>
                            <th className="px-3 py-2 font-medium">Lot</th>
                            <th className="px-3 py-2 font-medium">Ordered</th>
                            <th className="px-3 py-2 font-medium">Remark</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poLines.map((l, i) => (
                            <tr
                              key={`${p.id}-${l.item_code}-${i}`}
                              className="border-t border-black/5 dark:border-white/5"
                            >
                              <td className="px-3 py-2">
                                {l.item_master?.name ?? "—"}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">
                                {l.item_code}
                              </td>
                              <td className="px-3 py-2 text-neutral-500">
                                {l.location ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-neutral-500">
                                {l.lot ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {Number(l.ordered_qty).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-neutral-500">
                                {l.remark ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}
