import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  STATUS_META,
  STATUS_ORDER,
  statusVar,
  type ReconRow,
} from "@/lib/reconciliation";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { ReconTabs } from "./recon-tabs";

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("purchase_head", "po_team", "approver", "md");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status")
    .eq("id", sheetId)
    .limit(1);
  const sheet = sheetRows?.[0];
  if (!sheet) notFound();

  // Paged: Supabase caps a read at 1000 rows, and a large sheet exceeds that.
  // A truncated read here under-reports every quantity on the page.
  const recon = (await fetchAll((from, to) =>
    supabase
      .from("reconciliation")
      .select("*")
      .eq("rm_sheet_id", sheetId)
      .order("item_code")
      .order("lot")
      .order("location")
      .range(from, to)
  )) as ReconRow[];

  // Lines still needing an item-code resolution (not in the view).
  const { count: needsReview } = await supabase
    .from("rm_requirement")
    .select("*", { count: "exact", head: true })
    .eq("rm_sheet_id", sheetId)
    .eq("needs_review", true);

  const counts: Record<string, number> = {};
  for (const r of recon) if (r.status) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return (
    <AppShell profile={profile}>
      <Link
        href="/procurement/reconciliation"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← All sheets
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {sheet.style_ref ?? `Sheet ${sheet.id.slice(0, 8)}`}
        </h1>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium dark:bg-neutral-800">
          {sheet.status}
        </span>
      </div>
      <p className="mt-1 text-neutral-500">
        Reconciliation of {recon.length} item(s) — purchased vs required.
        {needsReview ? ` ${needsReview} line(s) still need an item-code match.` : ""}
      </p>



      <div className="mt-8">
        {recon.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            Nothing to reconcile yet — no requirements or POs for this sheet.
          </p>
        ) : (
          <ReconTabs rows={recon} />
        )}
      </div>
    </AppShell>
  );
}
