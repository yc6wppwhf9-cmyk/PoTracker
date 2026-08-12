import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PoForm, type AssignedItem } from "./po-form";
import { SendPoBtn, LineDeliveryFields } from "./send-po-btn";
import { BulkSendProvider, SelectPo } from "./bulk-send";
import { shortSite } from "@/lib/sites";

/**
 * Delivery in one line, for the collapsed header of a sent PO.
 *
 * ETD and site now live on each line, so an order need not have a single one.
 * Where the lines differ this says so rather than showing the first — a date on
 * a header that only some of the order will meet is worse than no date.
 */
function deliverySummary(
  lines: { etd?: string | null; site?: string | null }[]
): string {
  const etds = new Set(lines.map((l) => l.etd).filter(Boolean));
  const sites = new Set(lines.map((l) => l.site).filter(Boolean));

  const etd =
    etds.size === 0
      ? "no ETD"
      : etds.size === 1
        ? `ETD ${new Date([...etds][0] as string).toLocaleDateString("en-GB")}`
        : `${etds.size} ETDs`;
  const site =
    sites.size === 0
      ? "no site"
      : sites.size === 1
        ? shortSite([...sites][0] as string)
        : `${sites.size} sites`;

  return `${etd} · ${site}`;
}

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

  // An admin sees every assigned line on the sheet, not just their own (they
  // have none), so the full buyer flow can be tested without a self-assignment.
  const isAdmin = profile.role === "admin";

  const sheetQuery = supabase
    .from("rm_sheet")
    .select("id, style_ref, status")
    .eq("id", sheetId)
    .limit(1);

  // This buyer's assigned lines for the sheet, with catalogue detail.
  // Paged: a truncated read would hide orderable lines from the buyer, so the
  // PO they raise would under-order.
  const linesQuery = fetchAll((from, to) => {
    let q = supabase
      .from("rm_requirement")
      .select("item_code, lot, location, required_qty, item_master(name, category)")
      .eq("rm_sheet_id", sheetId)
      .not("item_code", "is", null);
    if (!isAdmin) q = q.eq("assigned_buyer", profile.userId);
    return q.order("id").range(from, to);
  });

  // What is already on a PO for this sheet, per (item_code, lot, plant).
  //
  // Without this the form re-offers the full requirement on every visit, and a
  // buyer topping up half a lot orders the whole thing again. Drafts count
  // here even though reconciliation excludes them: an unsent draft commits
  // nobody downstream, but it is still material this buyer has allocated and
  // must not allocate twice.
  const coveredQuery = fetchAll((from, to) =>
    supabase
      .from("reconciliation")
      .select("item_code, lot, location, ordered, drafted")
      .eq("rm_sheet_id", sheetId)
      .order("item_code")
      .order("lot")
      .order("location")
      .range(from, to)
  );
  // Existing POs this buyer created for the sheet, with their line items.
  const posQuery = supabase
    .from("po")
    .select(
      "id, status, created_at, doc_path, etd, site, po_number, po_line(id, item_code, lot, location, ordered_qty, supplier, remark, etd, site, item_master(name))"
    )
    .eq("rm_sheet_id", sheetId)
    .eq("created_by", profile.userId)
    .order("created_at", { ascending: false });

  // All four reads at once. None of them needs another's answer, and issued
  // one after the other they were four sequential round trips to the database
  // — which is most of what this page cost before its region was fixed.
  const [sheetRes, lines, covered, posRes] = await Promise.all([
    sheetQuery,
    linesQuery,
    coveredQuery,
    posQuery,
  ]);

  const sheet = sheetRes.data?.[0];
  if (!sheet) notFound();
  const pos = posRes.data;

  const coveredBy = new Map<string, { ordered: number; drafted: number }>();
  for (const c of covered) {
    coveredBy.set(
      `${c.item_code}__${c.lot ?? ""}__${c.location ?? ""}`,
      { ordered: Number(c.ordered) || 0, drafted: Number(c.drafted) || 0 }
    );
  }

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
        ordered_qty: coveredBy.get(key)?.ordered ?? 0,
        drafted_qty: coveredBy.get(key)?.drafted ?? 0,
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
        {items.length} item(s) {isAdmin ? "on this sheet" : "assigned to you"}.
        Select the items you are ordering, then record the supplier and rate for
        each.
      </p>

      <div className="mt-6">
        {items.length === 0 ? (
          <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            {isAdmin ? "This sheet has no orderable items." : "No items assigned to you on this sheet."}
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
          <BulkSendProvider
            draftIds={(pos ?? [])
              .filter((p) => p.status === "draft")
              .map((p) => p.id)}
          >
          <div className="mt-3 space-y-3">
            {pos.map((p) => {
              const poLines =
                (p.po_line as unknown as {
                  id: string;
                  item_code: string | null;
                  lot: string | null;
                  location: string | null;
                  ordered_qty: number;
                  supplier: string | null;
                  remark: string | null;
                  etd: string | null;
                  site: string | null;
                  item_master: { name?: string } | null;
                }[]) ?? [];
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex items-center gap-3">
                      <SelectPo poId={p.id} draft={p.status === "draft"} />
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
                          {deliverySummary(poLines)}
                        </span>
                      )}
                      {p.status === "draft" && (
                        <SendPoBtn poId={p.id} />
                      )}
                    </span>
                  </div>
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
                            <th className="px-3 py-2 font-medium">Supplier</th>
                            <th className="px-3 py-2 font-medium">Lot</th>
                            <th className="px-3 py-2 font-medium">Ordered</th>
                            <th className="px-3 py-2 font-medium">ETD</th>
                            <th className="px-3 py-2 font-medium">Site</th>
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
                                {l.supplier ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-neutral-500">
                                {l.lot ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {Number(l.ordered_qty).toLocaleString()}
                              </td>
                              <LineDeliveryFields
                                lineId={l.id}
                                etd={l.etd}
                                site={l.site}
                                editable={p.status === "draft"}
                              />
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
          </BulkSendProvider>
        </div>
      )}
    </AppShell>
  );
}
