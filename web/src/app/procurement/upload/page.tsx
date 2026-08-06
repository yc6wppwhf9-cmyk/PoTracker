import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { UploadForm } from "./upload-form";
import { formatDateTime } from "@/lib/format";

export default async function UploadPage() {
  const profile = await requireRole("uploader");
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from("rm_sheet")
    .select("id, style_ref, status, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Upload RM sheet</h1>
      <p className="mt-1 text-neutral-500">
        Drop the final raw-material requirement sheet (.xlsx). It’s parsed,
        matched to the item catalogue, and the Purchase Head is notified.
      </p>

      <div className="mt-6">
        <UploadForm />
      </div>

      {recent && recent.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Your recent uploads
          </h2>
          <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 bg-white dark:divide-white/5 dark:border-white/10 dark:bg-neutral-900">
            {recent.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span className="font-medium">
                  {s.style_ref ?? `Sheet ${s.id.slice(0, 8)}`}
                </span>
                <span className="flex items-center gap-3 text-neutral-500">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {s.status}
                  </span>
                  {formatDateTime(s.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
