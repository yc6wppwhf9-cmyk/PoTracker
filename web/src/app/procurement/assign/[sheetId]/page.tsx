import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { AssignForm, type CategoryGroup, type InvItemGroup, type BuyerOption } from "./assign-form";

const UNMATCHED = "__unmatched__";

export default async function AssignSheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const profile = await requireRole("purchase_head");
  const { sheetId } = await params;
  const supabase = await createClient();

  const { data: sheetRows } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at")
    .eq("id", sheetId)
    .limit(1);

  const sheetRow = sheetRows?.[0];
  if (!sheetRow) notFound();

  const { data: lines } = await supabase
    .from("rm_requirement")
    .select("id, item_code, raw_label, required_qty, assigned_buyer, needs_review, item_master(name, category)")
    .eq("rm_sheet_id", sheetId);

  const { data: buyerRows } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "buyer")
    .order("full_name", { ascending: true });

  const buyers: BuyerOption[] = (buyerRows ?? []).map((b) => ({
    id: b.id,
    name: b.full_name ?? b.email ?? b.id.slice(0, 8),
  }));

  // Group lines by catalogue category.
  type Acc = {
    lines: number;
    items: Set<string>;
    totalQty: number;
    buyers: Set<string | null>;
    needsReview: boolean;
  };
  const groups = new Map<string, Acc>();

  // Group lines by INV item code.
  type InvAcc = {
    itemCode: string;
    name: string;
    category: string;
    lines: number;
    totalQty: number;
    buyers: Set<string | null>;
  };
  const invMap = new Map<string, InvAcc>();

  for (const l of lines ?? []) {
    const im = l.item_master as { name?: string; category?: string } | null;
    const cat = l.item_code == null ? UNMATCHED : (im?.category ?? UNMATCHED);
    const code = l.item_code ?? "UNMATCHED";
    const name = im?.name ?? l.raw_label ?? code;

    if (!groups.has(cat))
      groups.set(cat, {
        lines: 0,
        items: new Set(),
        totalQty: 0,
        buyers: new Set(),
        needsReview: false,
      });
    const g = groups.get(cat)!;
    g.lines += 1;
    if (l.item_code) g.items.add(l.item_code);
    g.totalQty += Number(l.required_qty) || 0;
    g.buyers.add(l.assigned_buyer ?? null);
    if (l.needs_review) g.needsReview = true;

    if (l.item_code) {
      if (!invMap.has(code)) {
        invMap.set(code, {
          itemCode: code,
          name: name,
          category: cat === UNMATCHED ? "—" : cat,
          lines: 0,
          totalQty: 0,
          buyers: new Set(),
        });
      }
      const ig = invMap.get(code)!;
      ig.lines += 1;
      ig.totalQty += Number(l.required_qty) || 0;
      ig.buyers.add(l.assigned_buyer ?? null);
    }
  }

  const categoryGroups: CategoryGroup[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: key === UNMATCHED ? "Unmatched (needs review)" : key,
      lines: g.lines,
      items: g.items.size,
      totalQty: Math.round(g.totalQty * 100) / 100,
      currentBuyerId: g.buyers.size === 1 ? [...g.buyers][0] : null,
      mixed: g.buyers.size > 1,
      needsReview: g.needsReview,
      unmatched: key === UNMATCHED,
    }))
    .sort((a, b) => {
      if (a.unmatched !== b.unmatched) return a.unmatched ? 1 : -1;
      return a.label.localeCompare(b.label);
    });

  const invGroups: InvItemGroup[] = [...invMap.values()]
    .map((ig) => ({
      itemCode: ig.itemCode,
      name: ig.name,
      category: ig.category,
      lines: ig.lines,
      totalQty: Math.round(ig.totalQty * 100) / 100,
      currentBuyerId: ig.buyers.size === 1 ? [...ig.buyers][0] : null,
      mixed: ig.buyers.size > 1,
    }))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  return (
    <AppShell profile={profile}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/procurement/assign"
            className="text-sm text-neutral-500 hover:underline"
          >
            ← All sheets
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {sheetRow.style_ref ?? `Sheet ${sheetRow.id.slice(0, 8)}`}
          </h1>
        </div>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium dark:bg-neutral-800">
          {sheetRow.status}
        </span>
      </div>
      <p className="mt-1 text-neutral-500">
        {categoryGroups.length} categories · {invGroups.length} INV item codes. Assign buyers by category or directly by INV code below.
      </p>

      {buyers.length === 0 ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          No buyers exist yet. Ask an admin to set some users’ role to Buyer.
        </p>
      ) : (
        <div className="mt-6">
          <AssignForm
            sheetId={sheetId}
            groups={categoryGroups}
            invGroups={invGroups}
            buyers={buyers}
          />
        </div>
      )}
    </AppShell>
  );
}
