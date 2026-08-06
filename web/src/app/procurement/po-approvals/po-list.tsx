"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PoApproval } from "@/lib/po-approvals";
import { shortSite } from "@/lib/sites";
import { approvePo, escalatePo } from "./actions";

/**
 * Purchase orders awaiting the approver's decision, and those already decided.
 *
 * The approver is final here — the MD sees only what is escalated — so this is
 * the decision point for an order, not a step towards one.
 */
export function PoList({ pos }: { pos: PoApproval[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "approved">("pending");
  const [query, setQuery] = useState("");
  const [buyer, setBuyer] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const buyers = useMemo(
    () => [...new Set(pos.map((p) => p.buyer).filter(Boolean))].sort() as string[],
    [pos]
  );

  const counts = useMemo(
    () => ({
      pending: pos.filter((p) => p.approvalStatus !== "approved").length,
      approved: pos.filter((p) => p.approvalStatus === "approved").length,
    }),
    [pos]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pos.filter((p) => {
      const isApproved = p.approvalStatus === "approved";
      if (tab === "pending" && isApproved) return false;
      if (tab === "approved" && !isApproved) return false;
      if (buyer && p.buyer !== buyer) return false;
      if (!q) return true;
      return [p.poNumber, p.supplier, p.buyer, p.styleRef, p.site]
        .concat(p.items.flatMap((i) => [i.itemCode, i.name]))
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [pos, tab, buyer, query]);

  function onApprove(p: PoApproval) {
    setError(null);
    const label = p.poNumber ?? "this purchase order";
    if (
      !confirm(
        `Approve ${label}?\n\n` +
          `${p.supplier ?? "No supplier"} · ordered ${p.ordered.toLocaleString()} · ` +
          `received ${p.received.toLocaleString()}\n\n` +
          "You are the final approver — this does not go to the MD."
      )
    )
      return;
    startTransition(async () => {
      const res = await approvePo(p.id, null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function onEscalate(p: PoApproval) {
    setError(null);
    const reason = prompt(
      `Escalate ${p.poNumber ?? "this PO"} to ${p.buyer ?? "the buyer"}.\n\n` +
        "What do they need to answer?"
    );
    if (reason === null) return;
    startTransition(async () => {
      const res = await escalatePo(p.id, reason);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  if (pos.length === 0)
    return (
      <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
        No purchase orders have been sent for approval yet.
      </p>
    );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          {([
            ["pending", "Pending approval", counts.pending],
            ["approved", "Approved", counts.approved],
          ] as const).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                tab === key
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {label} ({n})
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PO number, supplier, item…"
          className="min-w-[16rem] flex-1 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-neutral-950"
        />
        <select
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
          className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-neutral-950"
        >
          <option value="">All buyers</option>
          {buyers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {shown.map((p) => {
          const outstanding = p.ordered - p.received;
          const fully = p.received >= p.ordered * 0.995;
          const over = p.received > p.ordered * 1.02;
          return (
            <div
              key={p.id}
              className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.poNumber ? (
                      <span className="font-mono text-sm font-semibold">
                        {p.poNumber}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        no PO number
                      </span>
                    )}
                    {p.escalation && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {p.escalation === "md_escalated"
                          ? "escalated to MD"
                          : "with buyer"}
                      </span>
                    )}
                    {p.approvalStatus === "approved" && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                        approved
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-medium">
                    {p.supplier ?? "No supplier set"}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {p.buyer ? `Raised by ${p.buyer}` : "No buyer recorded"}
                    {p.etd ? ` · ETD ${p.etd}` : " · no ETD"}
                    {p.site ? ` · ${shortSite(p.site)}` : ""}
                    {p.styleRef ? ` · ${p.styleRef}` : ""}
                    {p.hasDoc ? " · 📎 document attached" : " · no document yet"}
                  </div>
                  {p.approvalStatus === "approved" && (
                    <div className="mt-0.5 text-xs text-green-700 dark:text-green-400">
                      Approved by {p.approvedBy ?? "—"}
                      {p.approvedAt
                        ? ` on ${new Date(p.approvedAt).toLocaleDateString()}`
                        : ""}
                      {p.approvalNote ? ` — ${p.approvalNote}` : ""}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  {/* Ordered against received, because "how much came?" is the
                      first question and the reason to look at all. */}
                  <div className="text-right text-xs">
                    <div className="tabular-nums text-neutral-500">
                      ordered {p.ordered.toLocaleString()}
                    </div>
                    <div
                      className={`tabular-nums font-semibold ${
                        over
                          ? "text-rose-700 dark:text-rose-400"
                          : fully
                            ? "text-green-700 dark:text-green-400"
                            : "text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      received {p.received.toLocaleString()}
                      {over
                        ? ` (+${(p.received - p.ordered).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })} over)`
                        : fully
                          ? " (complete)"
                          : ` (${outstanding.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })} pending)`}
                    </div>
                    {p.value != null && (
                      <div className="tabular-nums text-neutral-400">
                        value {p.value.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    )}
                  </div>

                  {p.approvalStatus !== "approved" && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEscalate(p)}
                        disabled={pending || Boolean(p.escalation)}
                        title={
                          p.escalation
                            ? "Already escalated and unresolved"
                            : "Ask the buyer to answer for this order"
                        }
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        Escalate
                      </button>
                      <button
                        type="button"
                        onClick={() => onApprove(p)}
                        disabled={pending}
                        className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                      >
                        {pending ? "Working…" : "Approve"}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                    className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {open === p.id ? "hide items" : `${p.items.length} item(s)`}
                  </button>
                </div>
              </div>

              {open === p.id && (
                <div className="border-t border-black/5 px-5 py-3 dark:border-white/5">
                  <table className="w-full text-xs">
                    <thead className="text-left text-neutral-500">
                      <tr>
                        <th className="py-1 font-medium">Item</th>
                        <th className="py-1 font-medium">Lot</th>
                        <th className="py-1 text-right font-medium">Ordered</th>
                        <th className="py-1 text-right font-medium">Received</th>
                        <th className="py-1 text-right font-medium">Balance</th>
                        <th className="py-1 text-right font-medium">Rate</th>
                        <th className="py-1 text-right font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.items.map((it, i) => {
                        const bal = it.ordered - it.received;
                        return (
                          <tr key={`${it.itemCode}-${it.lot}-${i}`}>
                            <td className="py-1">
                              {it.name ?? it.itemCode}{" "}
                              <span className="font-mono text-neutral-400">
                                {it.itemCode}
                              </span>
                            </td>
                            <td className="py-1 text-neutral-500">{it.lot ?? "—"}</td>
                            <td className="py-1 text-right tabular-nums">
                              {it.ordered.toLocaleString()}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {it.received.toLocaleString()}
                            </td>
                            <td
                              className={`py-1 text-right tabular-nums ${
                                bal < -it.ordered * 0.02
                                  ? "font-semibold text-rose-700 dark:text-rose-400"
                                  : bal > 0
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-green-700 dark:text-green-400"
                              }`}
                            >
                              {bal > 0
                                ? bal.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })
                                : bal < 0
                                  ? `+${Math.abs(bal).toLocaleString(undefined, {
                                      maximumFractionDigits: 2,
                                    })} over`
                                  : "complete"}
                            </td>
                            <td className="py-1 text-right tabular-nums text-neutral-500">
                              {it.rate == null ? "—" : it.rate.toLocaleString()}
                            </td>
                            <td className="py-1 text-right tabular-nums text-neutral-500">
                              {it.value == null
                                ? "—"
                                : it.value.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
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
        })}
        {shown.length === 0 && (
          <p className="rounded-xl border border-black/10 bg-white px-4 py-8 text-center text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900">
            {query || buyer
              ? "Nothing matches that search."
              : tab === "pending"
                ? "Nothing is waiting for approval."
                : "Nothing approved yet."}
          </p>
        )}
      </div>
    </div>
  );
}
