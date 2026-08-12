import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { fetchAll } from "@/lib/supabase/fetch-all";

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
  const withWork = (sheets ?? []).filter((s) => (poCountBySheet.get(s.id) ?? 0) > 0);

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">PO team</h1>
      <p className="mt-1 text-neutral-500">
        Open a sheet to see the POs buyers have sent you, and attach the
        finalised PO documents.
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Sheet</th>
              <th className="px-4 py-3 font-medium">POs</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {withWork.map((s) => {
              const poCount = poCountBySheet.get(s.id) ?? 0;
              return (
                <tr
                  key={s.id}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-medium">
                    {s.style_ref ?? `Sheet ${s.id.slice(0, 8)}`}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{poCount}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/procurement/po-team/${s.id}`}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {withWork.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  Nothing to do — no buyer has sent you a purchase order yet.
                  Sheets appear here once one does.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
