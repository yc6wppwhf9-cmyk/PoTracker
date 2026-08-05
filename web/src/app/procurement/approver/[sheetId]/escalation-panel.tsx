"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/client";
import { raiseEscalation } from "../escalate-actions";

type FlaggedItem = {
  item_code: string;
  lot: string | null;
  name: string | null;
  status: string | null;
  buyerId: string;
  buyerName: string;
  /** Which PO covers this line, if one has been raised. */
  poNumbers: string[];
  suppliers: string[];
};

type Escalation = {
  id: string;
  item_code: string | null;
  lot: string | null;
  status: string;
  escalate_after: string;
  reason: string | null;
};

const lotKey = (c: string, l: string | null) => `${c}__${l ?? ""}`;

export function EscalationPanel({ sheetId }: { sheetId: string }) {
  const supabase = createClient();
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Flagged reconciliation lines (anything not on target). Paged — a
    // truncated read would hide flagged items the approver needs to escalate.
    const recon = await fetchAll((from, to) =>
      supabase
        .from("reconciliation")
        .select("item_code, lot, name, status")
        .eq("rm_sheet_id", sheetId)
        .neq("status", "on_target")
        .order("item_code")
        .order("lot")
        .order("location")
        .range(from, to)
    );

    // Assigned buyer per (item, lot).
    const reqs = await fetchAll((from, to) =>
      supabase
        .from("rm_requirement")
        .select("item_code, lot, assigned_buyer")
        .eq("rm_sheet_id", sheetId)
        .not("assigned_buyer", "is", null)
        .order("id")
        .range(from, to)
    );
    const buyerByKey = new Map<string, string>();
    for (const r of reqs)
      if (r.item_code)
        buyerByKey.set(lotKey(r.item_code, r.lot as string | null), r.assigned_buyer as string);

    const buyerIds = [...new Set([...buyerByKey.values()])];
    const { data: profs } = buyerIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", buyerIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const nameById = new Map(
      (profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id.slice(0, 8)])
    );

    // The PO covering each flagged line. The approver chases a supplier about a
    // specific order, so the PO number and supplier are what make the escalation
    // actionable — without them the message is "this item is short" with no
    // reference the supplier recognises. Drafts are excluded: an unsent draft is
    // not an order anyone can be held to.
    const poLines = await fetchAll((from, to) =>
      supabase
        .from("po_line")
        .select("item_code, lot, supplier, po!inner(po_number, rm_sheet_id, status)")
        .eq("po.rm_sheet_id", sheetId)
        .neq("po.status", "draft")
        .order("id")
        .range(from, to)
    );
    const poByKey = new Map<string, { numbers: Set<string>; suppliers: Set<string> }>();
    for (const l of poLines) {
      if (!l.item_code) continue;
      const k = lotKey(l.item_code as string, (l.lot as string | null) ?? null);
      const po = (Array.isArray(l.po) ? l.po[0] : l.po) as
        | { po_number: string | null }
        | null;
      const entry = poByKey.get(k) ?? { numbers: new Set(), suppliers: new Set() };
      if (po?.po_number) entry.numbers.add(po.po_number);
      const sup = (l.supplier as string | null)?.trim();
      if (sup) entry.suppliers.add(sup);
      poByKey.set(k, entry);
    }

    // Flagged lines with no assigned buyer cannot be escalated — there is
    // nobody to escalate to. Count them so the approver knows they exist
    // instead of them silently vanishing from the list.
    let unassignedFlagged = 0;

    const flagged: FlaggedItem[] = [];
    for (const r of recon) {
      if (!r.item_code) continue;
      const bId = buyerByKey.get(lotKey(r.item_code, r.lot as string | null));
      if (!bId) {
        unassignedFlagged += 1;
        continue;
      }
      const po = poByKey.get(lotKey(r.item_code, r.lot as string | null));
      flagged.push({
        item_code: r.item_code,
        lot: (r.lot as string | null) ?? null,
        name: r.name,
        status: r.status,
        buyerId: bId,
        buyerName: nameById.get(bId) ?? "—",
        poNumbers: [...(po?.numbers ?? [])],
        suppliers: [...(po?.suppliers ?? [])],
      });
    }

    const { data: esc } = await supabase
      .from("escalation")
      .select("id, item_code, lot, status, escalate_after, reason")
      .eq("rm_sheet_id", sheetId)
      .order("created_at", { ascending: false });

    setItems(flagged);
    setUnassigned(unassignedFlagged);
    setEscalations((esc ?? []) as Escalation[]);
    setLoading(false);
  }, [supabase, sheetId]);

  useEffect(() => {
    // The panel loads its own data because it also reloads after an escalation
    // is raised, without navigating. `load` sets state only after awaiting, but
    // the rule cannot see through the async callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const openByKey = new Map(
    escalations
      .filter((e) => e.status !== "resolved")
      .map((e) => [lotKey(e.item_code ?? "", e.lot), e])
  );

  async function escalate(it: FlaggedItem) {
    const k = lotKey(it.item_code, it.lot);
    setBusy(k);
    setErr(null);
    const fd = new FormData();
    fd.set("sheet_id", sheetId);
    fd.set("item_code", it.item_code);
    if (it.lot) fd.set("lot", it.lot);
    fd.set("reason", reasons[k] ?? "");
    const res = await raiseEscalation({ error: null, ok: false }, fd);
    setBusy(null);
    if (res.error) setErr(res.error);
    else await load();
  }

  if (loading)
    return <p className="text-sm text-neutral-400">Loading flagged items…</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Escalate to buyers</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Flagged materials with an assigned buyer. Escalating notifies the buyer;
        if unresolved in 9 working hours it auto-escalates to the MD.
      </p>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      {unassigned > 0 && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {unassigned.toLocaleString()} flagged line(s) are hidden because no
          buyer is assigned to them — there is nobody to escalate to. Ask the
          purchase head to assign buyers on this sheet.
        </p>
      )}

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-black/[0.08] bg-white px-4 py-6 text-center text-sm text-neutral-500 dark:border-white/[0.08] dark:bg-neutral-900">
          Nothing to escalate — no flagged items with an assigned buyer.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-white/[0.06]">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Lot</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">PO number</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const k = lotKey(it.item_code, it.lot);
                const open = openByKey.get(k);
                return (
                  <tr
                    key={k}
                    className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{it.name ?? it.item_code}</div>
                      <div className="font-mono text-xs text-neutral-400">
                        {it.item_code}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{it.lot ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-500">{it.status}</td>
                    <td className="px-4 py-3">
                      {it.poNumbers.length > 0 ? (
                        <span className="font-mono text-xs font-semibold">
                          {it.poNumbers.join(", ")}
                        </span>
                      ) : (
                        /* No PO yet is itself the thing to escalate about. */
                        <span className="text-xs text-neutral-400">no PO raised</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                      {it.suppliers.length > 0 ? it.suppliers.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">{it.buyerName}</td>
                    <td className="px-4 py-3">
                      {open ? (
                        <span className="text-xs text-neutral-400">
                          {open.reason ?? "—"}
                        </span>
                      ) : (
                        <input
                          type="text"
                          value={reasons[k] ?? ""}
                          onChange={(e) =>
                            setReasons((r) => ({ ...r, [k]: e.target.value }))
                          }
                          placeholder="optional reason"
                          className="w-40 rounded-md border border-black/10 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-950"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {open ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            color:
                              open.status === "md_escalated"
                                ? "var(--st-critical-ink)"
                                : "var(--st-warn-ink)",
                            backgroundColor:
                              open.status === "md_escalated"
                                ? "var(--st-critical-tint)"
                                : "var(--st-warn-tint)",
                          }}
                        >
                          {open.status === "md_escalated"
                            ? "escalated to MD"
                            : "with buyer"}
                        </span>
                      ) : (
                        <button
                          onClick={() => escalate(it)}
                          disabled={busy === k}
                          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                        >
                          {busy === k ? "Escalating…" : "Escalate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
