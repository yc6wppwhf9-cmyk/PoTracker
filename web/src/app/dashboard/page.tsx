import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { ROLE_LABELS } from "@/lib/roles";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AppRole } from "@/lib/database.types";
import { hourInBusinessZone } from "@/lib/format";

type DB = SupabaseClient<Database>;

type Tile = { label: string; value: number | string; hint?: string };
type Action = { href: string; label: string; desc: string };

const head = { count: "exact" as const, head: true };

async function dataFor(
  role: AppRole,
  userId: string,
  db: DB
): Promise<{ tiles: Tile[]; actions: Action[] }> {
  switch (role) {
    case "uploader": {
      const { count: sheets } = await db
        .from("rm_sheet")
        .select("*", head)
        .eq("uploaded_by", userId);
      return {
        tiles: [{ label: "Your uploads", value: sheets ?? 0, hint: "RM sheets" }],
        actions: [
          {
            href: "/procurement/upload",
            label: "Upload an RM sheet",
            desc: "Drop the final .xlsx requirement sheet to launch purchasing.",
          },
        ],
      };
    }
    case "purchase_head": {
      const [toAssign, assigned, total] = await Promise.all([
        db.from("rm_sheet").select("*", head).eq("status", "uploaded"),
        db.from("rm_sheet").select("*", head).eq("status", "assigned"),
        db.from("rm_sheet").select("*", head),
      ]);
      return {
        tiles: [
          { label: "Awaiting assignment", value: toAssign.count ?? 0, hint: "sheets" },
          { label: "Assigned", value: assigned.count ?? 0, hint: "sheets" },
          { label: "Total sheets", value: total.count ?? 0 },
        ],
        actions: [
          {
            href: "/procurement/assign",
            label: "Assign buyers",
            desc: "Route each material category to specialized buyers.",
          },
        ],
      };
    }
    case "buyer": {
      const [myLines, myPos] = await Promise.all([
        db.from("rm_requirement").select("*", head).eq("assigned_buyer", userId),
        db.from("po").select("*", head).eq("created_by", userId),
      ]);
      return {
        tiles: [
          { label: "Assigned lines", value: myLines.count ?? 0 },
          { label: "POs drafted", value: myPos.count ?? 0 },
        ],
        actions: [
          {
            href: "/procurement/buyer",
            label: "Open your workspace",
            desc: "Draft POs and set MOQs for your assigned items.",
          },
        ],
      };
    }
    case "po_team": {
      const [drafts, uploaded] = await Promise.all([
        db.from("po").select("*", head).eq("status", "draft"),
        db.from("po").select("*", head).eq("status", "uploaded"),
      ]);
      return {
        tiles: [
          { label: "Awaiting document", value: drafts.count ?? 0, hint: "PO drafts" },
          { label: "Documents attached", value: uploaded.count ?? 0, hint: "POs" },
        ],
        actions: [
          {
            href: "/procurement/po-team",
            label: "Attach PO documents",
            desc: "Upload finalised PO files against draft orders.",
          },
        ],
      };
    }
    case "approver": {
      const [pending, total] = await Promise.all([
        db.from("rm_sheet").select("*", head).in("status", ["assigned", "reconciled"]),
        db.from("rm_sheet").select("*", head),
      ]);
      return {
        tiles: [
          { label: "Ready to review", value: pending.count ?? 0, hint: "sheets" },
          { label: "Total sheets", value: total.count ?? 0 },
        ],
        actions: [
          {
            href: "/procurement/approver",
            label: "Review Approvals",
            desc: "Verify purchases and send to the Managing Director.",
          },
        ],
      };
    }
    case "md": {
      const [pending, total] = await Promise.all([
        db.from("approval").select("*", head).eq("md_decision", "pending"),
        db.from("rm_sheet").select("*", head),
      ]);
      return {
        tiles: [
          { label: "Pending approval", value: pending.count ?? 0, hint: "requests" },
          { label: "Total sheets", value: total.count ?? 0 },
        ],
        actions: [
          {
            href: "/procurement/md",
            label: "MD Approval Dashboard",
            desc: "Review and grant final sign-off on PO packages.",
          },
        ],
      };
    }
    case "admin": {
      const [users, items, sheets] = await Promise.all([
        db.from("profiles").select("*", head),
        db.from("item_master").select("*", head),
        db.from("rm_sheet").select("*", head),
      ]);
      return {
        tiles: [
          { label: "System users", value: users.count ?? 0 },
          { label: "Item master", value: items.count ?? 0 },
          { label: "RM sheets", value: sheets.count ?? 0 },
        ],
        actions: [
          {
            href: "/admin/users",
            label: "Manage users & roles",
            desc: "Assign workflow roles to team members.",
          },
          {
            href: "/admin/item-master",
            label: "Item master",
            desc: "Import or review the master SKU list.",
          },
        ],
      };
    }
  }
}

export default async function DashboardPage() {
  const profile = await requireUser();
  const supabase = await createClient();
  const { tiles, actions } = await dataFor(
    profile.role,
    profile.userId,
    supabase as unknown as DB
  );

  // The server runs in UTC, so reading its clock greeted people with "Good
  // morning" in the middle of the afternoon.
  const hour = hourInBusinessZone();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <AppShell profile={profile}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {greet}
            {profile.fullName ? `, ${profile.fullName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            Welcome back to your {ROLE_LABELS[profile.role]} control panel.
          </p>
        </div>
      </div>

      {/* Stat Tiles */}
      {tiles.length > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t, idx) => (
            <div
              key={t.label}
              className="glass-card relative overflow-hidden rounded-2xl p-5"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                {t.label}
              </div>
              <div className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-white">
                {t.value}
              </div>
              {t.hint && (
                <div className="mt-1 text-xs font-medium text-slate-400">{t.hint}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions Header */}
      <h2 className="mt-10 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Quick actions
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group glass-card flex items-center justify-between rounded-2xl p-6 transition-all"
          >
            <div>
              <div className="font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-400 transition-colors">
                {a.label}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{a.desc}</div>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-400 transition-all group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:group-hover:border-indigo-900 dark:group-hover:bg-indigo-950 dark:group-hover:text-indigo-300">
              →
            </span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
