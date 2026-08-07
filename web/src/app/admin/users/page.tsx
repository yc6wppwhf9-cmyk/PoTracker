import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { RoleSelect } from "./role-select";
import { NewUserForm } from "./new-user-form";

export default async function AdminUsersPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .order("created_at", { ascending: true });

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">Users &amp; roles</h1>
      <p className="mt-1 text-neutral-500">
        Create a login and assign each person their workflow role.
      </p>

      <div className="mt-6">
        <NewUserForm />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr
                key={u.id}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3">{u.full_name ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-500">{u.email}</td>
                <td className="px-4 py-3">
                  <RoleSelect
                    userId={u.id}
                    currentRole={u.role}
                    disabled={u.id === profile.userId}
                  />
                </td>
              </tr>
            ))}
            {(!users || users.length === 0) && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-neutral-500">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-neutral-400">
        You cannot change your own role here (guards against locking yourself out
        of admin).
      </p>
    </AppShell>
  );
}
