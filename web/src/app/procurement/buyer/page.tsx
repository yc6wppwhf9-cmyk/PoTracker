import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { EscalationsView } from "@/components/escalations-view";

export default async function BuyerHome() {
  const profile = await requireRole("buyer");
  const supabase = await createClient();

  // Sheets where this buyer has assigned lines.
  const { data: mine } = await supabase
    .from("rm_requirement")
    .select("rm_sheet_id, rm_sheet(style_ref, status, created_at)")
    .eq("assigned_buyer", profile.userId);

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
  const sheets = [...bySheet.entries()].sort((a, b) =>
    b[1].created_at.localeCompare(a[1].created_at)
  );

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Buyer workspace</h1>
      <p className="mt-1 text-neutral-500">
        Sheets with items assigned to you. Open one to draft a PO.
      </p>

      <EscalationsView mode="buyer" title="Escalations for you — resolve promptly" />

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Sheet</th>
              <th className="px-4 py-3 font-medium">Your lines</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sheets.map(([id, s]) => (
              <tr
                key={id}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3 font-medium">
                  {s.style_ref ?? `Sheet ${id.slice(0, 8)}`}
                </td>
                <td className="px-4 py-3 text-neutral-500">{s.lines}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/procurement/buyer/${id}`}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {sheets.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  Nothing assigned to you yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
