import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { UploadPo } from "./upload-po";
import { ImportPoRegister } from "./import-po-register";

type PoLine = {
  item_code: string | null;
  lot: string | null;
  location: string | null;
  ordered_qty: number;
  moq: number;
  remark: string | null;
  item_master: { name?: string } | null;
};

export default async function PoTeamSheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("po_team");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status")
    .eq("id", sheetId)
    .limit(1);
  const sheet = sheetRows?.[0];
  if (!sheet) notFound();

  const { data: pos } = await supabase
    .from("po")
    .select(
      "id, status, doc_path, created_at, created_by, po_line(item_code, lot, location, ordered_qty, moq, remark, item_master(name))"
    )
    .eq("rm_sheet_id", sheetId)
    .order("created_at", { ascending: false });

  // created_by -> auth.users (no FK to profiles); resolve names separately.
  const buyerIds = [...new Set((pos ?? []).map((p) => p.created_by).filter(Boolean))];
  const { data: buyerProfiles } = buyerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", buyerIds as string[])
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map((buyerProfiles ?? []).map((b) => [b.id, b.full_name]));

  return (
    <AppShell profile={profile}>
      <Link
        href="/procurement/po-team"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← All sheets
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {sheet.style_ref ?? `Sheet ${sheet.id.slice(0, 8)}`}
      </h1>
      <p className="mt-1 text-neutral-500">
        {(pos ?? []).length} PO draft(s). Review lines, attach finalised document, or import PO register.
      </p>

      <div className="mt-6">
        <ImportPoRegister sheetId={sheetId} />
      </div>

      <div className="mt-6 space-y-4">
        {(pos ?? []).map((p) => {
          const lines = (p.po_line as unknown as PoLine[]) ?? [];
          const buyer = nameById.get(p.created_by as string) ?? "—";
          const totalQty = lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0), 0);
          return (
            <div
              key={p.id}
              className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <div className="font-mono text-xs text-neutral-500">
                    PO {p.id.slice(0, 8)}
                  </div>
                  <div className="font-medium">{buyer}</div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-neutral-500">
                    {lines.length} line(s) · {totalQty.toLocaleString()} total qty
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      p.status === "uploaded"
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                        : "bg-neutral-100 dark:bg-neutral-800"
                    }`}
                  >
                    {p.status}
                  </span>
                  {p.doc_path ? (
                    <span className="text-neutral-500">📎 attached</span>
                  ) : (
                    <UploadPo poId={p.id} />
                  )}
                </div>
              </div>

              <details className="group border-t border-black/5 dark:border-white/5">
                <summary className="cursor-pointer list-none px-5 py-3 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                  <span className="group-open:hidden">▸ View {lines.length} line item(s)</span>
                  <span className="hidden group-open:inline">▾ Hide line items</span>
                </summary>
                <div className="overflow-x-auto px-2 pb-3">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Item</th>
                        <th className="px-3 py-2 font-medium">Code</th>
                        <th className="px-3 py-2 font-medium">Plant</th>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">Ordered qty</th>
                        <th className="px-3 py-2 font-medium">MOQ</th>
                        <th className="px-3 py-2 font-medium">Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
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
                            {Number(l.moq).toLocaleString()}
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
        {(!pos || pos.length === 0) && (
          <p className="rounded-2xl border border-black/10 bg-white px-4 py-6 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            No PO drafts yet — buyers create them first.
          </p>
        )}
      </div>
    </AppShell>
  );
}
