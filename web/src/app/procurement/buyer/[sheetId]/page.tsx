import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PoForm } from "./po-form";
import { outstanding, type AssignedItem } from "./assigned-item";
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

  const sheetQuery = supabase
    .from("rm_sheet")
    .select("id, style_ref, status")
    .eq("id", sheetId)
    .limit(1);

  // This buyer's assigned lines for the sheet, with catalogue detail.
  // Paged: a truncated read would hide orderable lines from the buyer, so the
  // PO they raise would under-order.
  const linesQuery = fetchAll((from, to) =>
    supabase
      .from("rm_requirement")
      .select("item_code, lot, location, required_qty, department, item_master(name, category)")
      .eq("rm_sheet_id", sheetId)
      .eq("assigned_buyer", profile.userId)
      .not("item_code", "is", null)
      .order("id")
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

  // Three reads at once. None of them needs another's answer, and issued one
  // after the other they were sequential round trips to the database — which
  // is most of what this page cost before its region was fixed.
  const [sheetRes, lines, posRes] = await Promise.all([
    sheetQuery,
    linesQuery,
    posQuery,
  ]);

  const sheet = sheetRes.data?.[0];
  if (!sheet) notFound();
  const pos = posRes.data;

  // What is already on a PO for this sheet, per (item_code, lot, plant).
  //
  // Without this the form re-offers the full requirement on every visit, and a
  // buyer topping up half a lot orders the whole thing again. Drafts count
  // here even though reconciliation excludes them: an unsent draft commits
  // nobody downstream, but it is still material this buyer has allocated and
  // must not allocate twice.
  //
  // Scoped to this buyer's own item codes, not the whole sheet. A sheet can
  // carry thousands of reconciliation rows across every buyer on it; a buyer
  // only ever needs the slice that covers their own assigned lines, and
  // fetching the rest was paging through rows this page never uses — on a
  // large sheet, enough round trips to time the page out. Sequenced after
  // linesQuery (it needs the item codes), rather than joined into the
  // Promise.all above.
  const itemCodes = [...new Set(lines.map((l) => l.item_code).filter(Boolean))] as string[];
  const covered = itemCodes.length
    ? await fetchAll((from, to) =>
        supabase
          .from("reconciliation")
          .select("item_code, lot, location, ordered, drafted")
          .eq("rm_sheet_id", sheetId)
          .in("item_code", itemCodes)
          .order("item_code")
          .order("lot")
          .order("location")
          .range(from, to)
      )
    : [];

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
        department: (l.department as string | null) ?? "—",
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

  // Consolidated totals across this buyer's lines on the sheet — what still
  // needs buying, rolled up two ways. "To buy" is outstanding(), the same
  // figure the form itself pre-fills, so this matches what raising POs from
  // the table below will actually order rather than the original requirement.
  type DeptRow = { key: string; required: number; toBuy: number; lines: number };
  type ItemRow = {
    key: string;
    name: string;
    category: string;
    required: number;
    toBuy: number;
    lines: number;
  };
  const byDept = new Map<string, DeptRow>();
  const byItemCode = new Map<string, ItemRow>();
  for (const it of items) {
    const toBuy = outstanding(it);

    const d = byDept.get(it.department) ?? {
      key: it.department,
      required: 0,
      toBuy: 0,
      lines: 0,
    };
    d.required += it.required_qty;
    d.toBuy += toBuy;
    d.lines += 1;
    byDept.set(it.department, d);

    const i = byItemCode.get(it.item_code) ?? {
      key: it.item_code,
      name: it.name,
      category: it.category,
      required: 0,
      toBuy: 0,
      lines: 0,
    };
    i.required += it.required_qty;
    i.toBuy += toBuy;
    i.lines += 1;
    byItemCode.set(it.item_code, i);
  }
  const deptRows = [...byDept.values()].sort(
    (a, b) => b.toBuy - a.toBuy || a.key.localeCompare(b.key)
  );
  const itemRows = [...byItemCode.values()].sort(
    (a, b) => b.toBuy - a.toBuy || a.name.localeCompare(b.name)
  );
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });

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

      {items.length > 0 && (
        <details className="group mt-6 rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span> Consolidated
            view — by department and by item
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-black/5 p-4 dark:border-white/5 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                By department
              </h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="border-b border-black/10 px-2 py-1.5 font-medium dark:border-white/10">
                      Department
                    </th>
                    <th className="border-b border-black/10 px-2 py-1.5 text-right font-medium dark:border-white/10">
                      Lines
                    </th>
                    <th className="border-b border-black/10 px-2 py-1.5 text-right font-medium dark:border-white/10">
                      Required
                    </th>
                    <th className="border-b border-black/10 px-2 py-1.5 text-right font-medium dark:border-white/10">
                      To buy
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deptRows.map((d) => (
                    <tr key={d.key} className="border-b border-black/5 last:border-0 dark:border-white/5">
                      <td className="px-2 py-1.5">{d.key}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                        {d.lines}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                        {fmt(d.required)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                        {fmt(d.toBuy)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                By item
              </h3>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                    <tr>
                      <th className="border-b border-black/10 px-2 py-1.5 font-medium dark:border-white/10">
                        Item
                      </th>
                      <th className="border-b border-black/10 px-2 py-1.5 text-right font-medium dark:border-white/10">
                        Lines
                      </th>
                      <th className="border-b border-black/10 px-2 py-1.5 text-right font-medium dark:border-white/10">
                        Required
                      </th>
                      <th className="border-b border-black/10 px-2 py-1.5 text-right font-medium dark:border-white/10">
                        To buy
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemRows.map((r) => (
                      <tr key={r.key} className="border-b border-black/5 last:border-0 dark:border-white/5">
                        <td className="px-2 py-1.5">
                          <div className="max-w-[200px] truncate font-medium" title={r.name}>
                            {r.name}
                          </div>
                          <div className="font-mono text-xs text-neutral-500">{r.key}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                          {r.lines}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                          {fmt(r.required)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {fmt(r.toBuy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </details>
      )}

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
