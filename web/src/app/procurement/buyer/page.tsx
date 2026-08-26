import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { EscalationsView } from "@/components/escalations-view";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { SheetTable } from "./sheet-table";

export default async function BuyerHome() {
  const profile = await requireRole("buyer");
  const supabase = await createClient();

  // Sheets where this buyer has assigned lines.
  // Paged: a truncated read here does not just undercount one sheet, it can
  // drop a whole sheet from the list — a buyer with more than 1000 assigned
  // lines across several sheets would see only however many of them fit in
  // the first thousand rows returned, silently.
  const mine = await fetchAll((from, to) =>
    supabase
      .from("rm_requirement")
      .select("rm_sheet_id, rm_sheet(style_ref, status, created_at)")
      .eq("assigned_buyer", profile.userId)
      .order("id")
      .range(from, to)
  );

  // Collapse to distinct sheets with a line count.
  const bySheet = new Map<
    string,
    { style_ref: string | null; status: string; created_at: string; lines: number }
  >();
  for (const r of mine ?? []) {
    const s = r.rm_sheet as {
      style_ref: string | null;
      status: string;
      created_at: string;
    } | null;
    if (!s) continue;
    const cur = bySheet.get(r.rm_sheet_id) ?? {
      style_ref: s.style_ref,
      status: s.status,
      created_at: s.created_at,
      lines: 0,
    };
    cur.lines += 1;
    bySheet.set(r.rm_sheet_id, cur);
  }
  const sheets = [...bySheet.entries()]
    .sort((a, b) => b[1].created_at.localeCompare(a[1].created_at))
    .map(([id, s]) => ({
      id,
      style_ref: s.style_ref,
      status: s.status,
      lines: s.lines,
    }));

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Buyer workspace</h1>
      <p className="mt-1 text-neutral-500">
        Sheets with items assigned to you. Open one to draft a PO.
      </p>

      <EscalationsView mode="buyer" title="Escalations for you — resolve promptly" />

      <SheetTable sheets={sheets} />
    </AppShell>
  );
}
