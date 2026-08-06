"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveEscalation } from "@/app/procurement/approver/escalate-actions";
import { formatDateTime } from "@/lib/format";

type Row = {
  id: string;
  item_code: string | null;
  lot: string | null;
  status: string;
  reason: string | null;
  escalate_after: string;
  escalated_to_md_at: string | null;
  assigned_buyer: string | null;
  item_master: { name?: string } | null;
};

export function EscalationsView({
  mode,
  title,
}: {
  mode: "buyer" | "md";
  title: string;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let query = supabase
      .from("escalation")
      .select(
        "id, item_code, lot, status, reason, escalate_after, escalated_to_md_at, assigned_buyer, item_master(name)"
      )
      .order("escalate_after", { ascending: true });

    if (mode === "md") {
      query = query.eq("status", "md_escalated");
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      query = query.eq("assigned_buyer", user?.id ?? "").neq("status", "resolved");
    }

    const { data } = await query;
    const list = (data ?? []) as Row[];

    const buyerIds = [...new Set(list.map((r) => r.assigned_buyer).filter(Boolean))];
    if (buyerIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", buyerIds as string[]);
      setNames(
        new Map(
          (profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id.slice(0, 8)])
        )
      );
    }
    setRows(list);
    setLoading(false);
  }, [supabase, mode]);

  useEffect(() => {
    // The panel loads its own data and re-loads on a realtime change. `load`
    // sets state only after awaiting, but the rule cannot see through the
    // async callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const ch = supabase
      .channel(`escalations-${mode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "escalation" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, mode, load]);

  async function resolve(id: string) {
    setBusy(id);
    const fd = new FormData();
    fd.set("escalation_id", id);
    await resolveEscalation({ error: null, ok: false }, fd);
    setBusy(null);
    await load();
  }

  if (loading || rows.length === 0) {
    // Hide the section entirely when there's nothing to show.
    return null;
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-white/[0.06]">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Lot</th>
              {mode === "md" && <th className="px-4 py-3">Buyer</th>}
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Deadline</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {r.item_master?.name ?? r.item_code}
                  </div>
                  <div className="font-mono text-xs text-neutral-400">
                    {r.item_code}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-500">{r.lot ?? "—"}</td>
                {mode === "md" && (
                  <td className="px-4 py-3">
                    {names.get(r.assigned_buyer ?? "") ?? "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-neutral-500">{r.reason ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={
                      r.status === "md_escalated"
                        ? {
                            color: "var(--st-critical-ink)",
                            backgroundColor: "var(--st-critical-tint)",
                          }
                        : {
                            color: "var(--st-warn-ink)",
                            backgroundColor: "var(--st-warn-tint)",
                          }
                    }
                  >
                    {r.status === "md_escalated"
                      ? "SLA passed"
                      : formatDateTime(r.escalate_after)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => resolve(r.id)}
                    disabled={busy === r.id}
                    className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-neutral-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-neutral-800"
                  >
                    {busy === r.id ? "…" : "Mark resolved"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
