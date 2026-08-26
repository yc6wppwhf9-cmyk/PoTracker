import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getPoApprovals } from "@/lib/po-approvals";
import { PoList } from "@/app/procurement/po-approvals/po-list";
import { SheetTable } from "./sheet-table";

export default async function PoTeamHome() {
  const profile = await requireRole("po_team");
  const supabase = await createClient();

  const { data: sheets } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at")
    .order("created_at", { ascending: false });

  // Counted here rather than as an embedded po(count), which would include the
  // buyer's drafts — POs the PO team cannot see and must not be told to expect.
  //
  // Paged: past a thousand orders Supabase truncates without an error, and the
  // counts would quietly understate, hiding sheets that do have work.
  const sentPos = await fetchAll<{ id: string; rm_sheet_id: string }>(
    (from, to) =>
      supabase
        .from("po")
        .select("id, rm_sheet_id")
        .neq("status", "draft")
        .order("id")
        .range(from, to)
  );
  const poCountBySheet = new Map<string, number>();
  for (const p of sentPos)
    poCountBySheet.set(
      p.rm_sheet_id,
      (poCountBySheet.get(p.rm_sheet_id) ?? 0) + 1
    );

  // Only sheets that actually have work here.
  //
  // Every sheet was listed and then annotated with a count, so a sheet whose
  // buyers have not sent anything appeared with 0 POs and an Open button
  // leading to an empty page. This screen is a queue: a row on it should mean
  // there is something to attach.
  const withWork = (sheets ?? [])
    .filter((s) => (poCountBySheet.get(s.id) ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      style_ref: s.style_ref,
      status: s.status,
      poCount: poCountBySheet.get(s.id) ?? 0,
    }));

  // Read-only view of the approver's decision — the PO team cannot approve or
  // escalate, but knowing which of their POs are still pending vs already
  // approved tells them what is safe to consider final.
  const approvals = await getPoApprovals();

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">PO team</h1>
      <p className="mt-1 text-neutral-500">
        Open a sheet to see the POs buyers have sent you, and attach the
        finalised PO documents.
      </p>

      <SheetTable sheets={withWork} />

      <h2 className="mt-10 text-lg font-semibold tracking-tight">
        PO approval status
      </h2>
      <p className="mt-1 text-neutral-500">
        Where each PO stands with the approver. This is view-only — approving
        or escalating happens on the approver's own screen.
      </p>
      <div className="mt-3">
        <PoList pos={approvals} readOnly />
      </div>
    </AppShell>
  );
}
