"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionProfile } from "@/lib/auth";
import type { AppRole } from "@/lib/database.types";
import { ROLE_LABELS } from "@/lib/roles";
import { signOut } from "@/app/login/actions";

type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
  ready: boolean;
  icon: (props: { className?: string }) => React.JSX.Element;
};

function getInitials(email: string | null, fullName?: string | null): string {
  if (fullName && fullName.trim()) {
    const parts = fullName.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  // No name and no email: two letters of nothing is better than a crash.
  return (email ?? "?").slice(0, 2).toUpperCase();
}

function getRoleBadgeStyle(role: AppRole) {
  switch (role) {
    case "admin":
      return "border-purple-300/70 bg-purple-50/80 text-purple-700 dark:border-purple-800/80 dark:bg-purple-950/60 dark:text-purple-300 shadow-xs shadow-purple-500/10";
    case "md":
      return "border-emerald-300/70 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300 shadow-xs shadow-emerald-500/10";
    case "approver":
      return "border-blue-300/70 bg-blue-50/80 text-blue-700 dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300 shadow-xs shadow-blue-500/10";
    case "purchase_head":
      return "border-indigo-300/70 bg-indigo-50/80 text-indigo-700 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300 shadow-xs shadow-indigo-500/10";
    case "buyer":
      return "border-amber-300/70 bg-amber-50/80 text-amber-700 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-300 shadow-xs shadow-amber-500/10";
    case "po_team":
      return "border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-800/80 dark:bg-sky-950/60 dark:text-sky-300 shadow-xs shadow-sky-500/10";
    default:
      return "border-slate-300/70 bg-slate-100/80 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300";
  }
}

// Clean inline SVG Icons for navigation items
function IconDashboard({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function IconUpload({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}

function IconAssign({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}

function IconBuyer({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  );
}

function IconPoTeam({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}


function IconApprover({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function IconPoApprovals({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function IconPendingPos({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconReceipts({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconMd({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function IconItemMaster({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function IconUsers({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function IconLogOut({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: [], ready: true, icon: IconDashboard },
  { href: "/procurement/upload", label: "Upload RM Sheet", roles: ["uploader"], ready: true, icon: IconUpload },
  { href: "/procurement/assign", label: "Assign Buyers", roles: ["purchase_head"], ready: true, icon: IconAssign },
  { href: "/procurement/buyer", label: "Buyer Workspace", roles: ["buyer"], ready: true, icon: IconBuyer },
  { href: "/procurement/po-team", label: "PO Team", roles: ["po_team"], ready: true, icon: IconPoTeam },
  { href: "/procurement/approver", label: "MR Sheets to Approve", roles: ["approver"], ready: true, icon: IconApprover },
  { href: "/procurement/po-approvals", label: "PO Approvals", roles: ["approver"], ready: true, icon: IconPoApprovals },
  { href: "/procurement/pending-pos", label: "Pending POs", roles: ["approver", "purchase_head", "md"], ready: true, icon: IconPendingPos },
  { href: "/procurement/receipts", label: "GRN Register", roles: ["approver", "purchase_head", "md", "po_team"], ready: true, icon: IconReceipts },
  { href: "/procurement/md", label: "MD Dashboard", roles: ["md"], ready: true, icon: IconMd },
  { href: "/admin/item-master", label: "Item Master", roles: ["admin"], ready: true, icon: IconItemMaster },
  { href: "/admin/users", label: "Users", roles: ["admin"], ready: true, icon: IconUsers },
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
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const items = NAV.filter((i) => visibleTo(i, profile.role));
  const initials = getInitials(profile.email, profile.fullName);

  const isLinkActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top Ambient Glow Line */}
      <div className="h-0.5 w-full bg-gradient-to-r from-indigo-500 via-blue-500 to-indigo-600" />

      {/* Sticky Glassmorphic Header */}
      <header className="glass-header sticky top-0 z-50 border-b border-slate-200/80 dark:border-slate-800/80 shadow-xs">
        <div className="mx-auto flex max-w-[112rem] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile Hamburger Menu Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-xs transition-all hover:bg-slate-100 md:hidden dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            {/* App Brand Logo */}
            <Link href="/dashboard" className="group flex items-center gap-3 font-bold tracking-tight">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-blue-500 text-white shadow-md shadow-indigo-500/25 text-xs font-black ring-2 ring-indigo-500/20 group-hover:scale-105 transition-transform">
                RM
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-800 bg-clip-text text-transparent dark:from-white dark:via-slate-200 dark:to-slate-300">
                    Procurement Engine
                  </span>
                  <span className="hidden sm:inline-flex rounded-full border border-indigo-200/80 bg-indigo-50/60 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-indigo-400">
                    v1.0
                  </span>
                </div>
                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                  RM → PO Reconciliation & Approvals
                </span>
              </div>
            </Link>
          </div>

          {/* User Profile, Role Badge & Logout Controls */}
          <div className="flex items-center gap-3 text-sm">
            {/* Styled User Chip with Initials Avatar */}
            <div className="flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/80 py-1 pl-1 pr-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-blue-600 text-[11px] font-bold text-white shadow-xs">
                {initials}
              </span>
              <div className="flex flex-col text-left">
                <span className="hidden text-xs font-semibold text-slate-800 sm:inline dark:text-slate-200">
                  {profile.fullName || profile.email?.split("@")[0] || "Account"}
                </span>
                <span className="hidden text-[10px] font-medium text-slate-400 sm:inline dark:text-slate-500">
                  {profile.email}
                </span>
              </div>
            </div>

            {/* Custom Role Badge with Glowing Dot */}
            <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${getRoleBadgeStyle(profile.role)}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              {ROLE_LABELS[profile.role]}
            </div>

            {/* Sign Out Button */}
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out of your session"
                className="flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.97] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-900/60 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
              >
                <IconLogOut className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover:text-rose-600" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile Sidebar Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative flex w-full max-w-xs flex-1 flex-col bg-white pt-5 pb-4 dark:bg-slate-900 shadow-xl border-r border-slate-200 dark:border-slate-800">
            <div className="px-4 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Navigation
              </div>
            </div>
            <div className="mt-4 h-0 flex-1 overflow-y-auto px-3">
              <nav className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isLinkActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                        active
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20 dark:bg-indigo-600 dark:text-white"
                          : "text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-indigo-400"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`h-4 w-4 ${active ? "text-white" : "text-slate-400 group-hover:text-indigo-600 dark:text-slate-500 dark:group-hover:text-indigo-400"}`} />
                        <span>{item.label}</span>
                      </div>
                      <span className={`text-xs transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>→</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="mx-auto flex max-w-[112rem] gap-8 px-4 py-8 sm:px-6">
        {/* Desktop Sidebar */}
        <nav className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 rounded-2xl glass-card p-3">
            <div className="mb-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Navigation
            </div>
            <ul className="space-y-1 text-sm">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isLinkActive(item.href);
                return (
                  <li key={item.href}>
                    {item.ready ? (
                      <Link
                        href={item.href}
                        className={`group flex items-center justify-between rounded-xl px-3 py-2.5 font-medium transition-all ${
                          active
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20 dark:bg-indigo-600 dark:text-white"
                            : "text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-indigo-400"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className={`h-4 w-4 ${active ? "text-white" : "text-slate-400 group-hover:text-indigo-600 dark:text-slate-500 dark:group-hover:text-indigo-400"}`} />
                          <span>{item.label}</span>
                        </div>
                        <span className={`text-xs transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>→</span>
                      </Link>
                    ) : (
                      <span className="flex items-center justify-between rounded-xl px-3 py-2.5 text-slate-400">
                        <div className="flex items-center gap-2.5">
                          <Icon className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                          <span>{item.label}</span>
                        </div>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide dark:bg-slate-800">
                          soon
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <main className="min-w-0 flex-1 animate-fade-in">{children}</main>
      </div>
    </div>
  );
}

