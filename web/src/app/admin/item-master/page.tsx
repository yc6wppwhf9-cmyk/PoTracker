import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { ImportForm } from "./import-form";

export default async function ItemMasterPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();

  const { count } = await supabase
    .from("item_master")
    .select("*", { count: "exact", head: true });

  const { data: sample } = await supabase
    .from("item_master")
    .select("item_code, name, category, base_unit, moq")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Item master</h1>
      <p className="mt-1 text-neutral-500">
        {count ?? 0} items on file. Import an .xlsx to add or update items — this
        is the join key for all reconciliation.
      </p>

      <div className="mt-6">
        <ImportForm />
      </div>

      {sample && sample.length > 0 && (
        <div className="mt-10 overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Base unit</th>
                <th className="px-4 py-3 font-medium">MOQ</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((it) => (
                <tr
                  key={it.item_code}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-mono text-xs">{it.item_code}</td>
                  <td className="px-4 py-3">{it.name}</td>
                  <td className="px-4 py-3 text-neutral-500">{it.category}</td>
                  <td className="px-4 py-3 text-neutral-500">{it.base_unit}</td>
                  <td className="px-4 py-3 text-neutral-500">{it.moq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
