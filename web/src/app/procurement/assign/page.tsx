import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { SheetTable } from "./sheet-table";

export default async function AssignListPage() {
  const profile = await requireRole("purchase_head", "uploader");
  const supabase = await createClient();

  const { data: sheets } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Assign buyers</h1>
      <p className="mt-1 text-neutral-500">
        Open a sheet and route each material category to the right buyer.
      </p>

      <SheetTable sheets={sheets ?? []} isAdmin={profile.role === "admin"} />
    </AppShell>
  );
}
