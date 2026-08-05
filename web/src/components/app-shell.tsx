import Link from "next/link";
import type { SessionProfile } from "@/lib/auth";
import type { AppRole } from "@/lib/database.types";
import { ROLE_LABELS } from "@/lib/roles";
import { signOut } from "@/app/login/actions";

type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
  ready: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: [], ready: true },
  { href: "/procurement/upload", label: "Upload RM Sheet", roles: ["uploader"], ready: true },
  { href: "/procurement/assign", label: "Assign Buyers", roles: ["purchase_head"], ready: true },
  { href: "/procurement/buyer", label: "Buyer Workspace", roles: ["buyer"], ready: true },
  { href: "/procurement/po-team", label: "PO Team", roles: ["po_team"], ready: true },
  { href: "/procurement/grn", label: "GRN Register", roles: ["po_team", "purchase_head"], ready: true },
  { href: "/procurement/approver", label: "Approvals", roles: ["approver"], ready: true },
  { href: "/procurement/md", label: "MD Dashboard", roles: ["md"], ready: true },
  { href: "/admin/item-master", label: "Item Catalogue", roles: ["admin"], ready: true },
  { href: "/admin/users", label: "Users", roles: ["admin"], ready: true },
];

function visibleTo(item: NavItem, role: AppRole): boolean {
  return item.roles.length === 0 || role === "admin" || item.roles.includes(role);
}

export function AppShell({
  profile,
  children,
}: {
  profile: SessionProfile;
  children: React.ReactNode;
}) {
  const items = NAV.filter((i) => visibleTo(i, profile.role));

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sticky Glassmorphic Header */}
      <header className="glass-header sticky top-0 z-50 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="mx-auto flex max-w-[112rem] items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-blue-500 text-white shadow-md shadow-indigo-500/20 text-xs font-black">
              RM
            </span>
            <span className="text-lg bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-800 bg-clip-text text-transparent dark:from-white dark:via-slate-200 dark:to-slate-300">
              Procurement Engine
            </span>
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden font-medium text-slate-500 sm:inline dark:text-slate-400">
              {profile.email}
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-indigo-200/60 bg-indigo-50/50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
              {ROLE_LABELS[profile.role]}
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs transition-all hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="mx-auto flex max-w-[112rem] gap-8 px-4 py-8 sm:px-6">
        <nav className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 rounded-2xl glass-card p-3">
            <div className="mb-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Navigation
            </div>
            <ul className="space-y-1 text-sm">
              {items.map((item) => (
                <li key={item.href}>
                  {item.ready ? (
                    <Link
                      href={item.href}
                      className="group flex items-center justify-between rounded-xl px-3 py-2.5 font-medium text-slate-700 transition-all hover:bg-indigo-50/80 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-indigo-400"
                    >
                      <span>{item.label}</span>
                      <span className="opacity-0 transition-opacity group-hover:opacity-100 text-xs">→</span>
                    </Link>
                  ) : (
                    <span className="flex items-center justify-between rounded-xl px-3 py-2.5 text-slate-400">
                      {item.label}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide dark:bg-slate-800">
                        soon
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <main className="min-w-0 flex-1 animate-fade-in">{children}</main>
      </div>
    </div>
  );
}
