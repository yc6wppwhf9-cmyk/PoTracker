"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPosToTeam } from "../actions";

/**
 * Selecting drafts and sending them together.
 *
 * A sheet produces one draft per supplier, so a buyer routinely finishes with
 * a dozen or more — and sending them individually is the same confirmation a
 * dozen times over.
 *
 * The selection lives in context rather than in each row so the toolbar can
 * count it and act on it. Only drafts are selectable; a sent PO has no
 * checkbox at all rather than a disabled one, since there is nothing the buyer
 * could do to make it selectable.
 */
type Ctx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  pending: boolean;
};

const SelectionContext = createContext<Ctx | null>(null);

export function BulkSendProvider({
  draftIds,
  children,
}: {
  draftIds: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    sent: number;
    error: string | null;
    failures: { poId: string; reason: string }[];
  } | null>(null);

  // Drafts can be sent while the page is open, so anything no longer a draft
  // is dropped from the selection rather than sent again.
  const live = [...selected].filter((id) => draftIds.includes(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function allOn() {
    setSelected(new Set(draftIds));
  }

  // One click sends, matching the per-PO button. Nothing is sent that was not
  // explicitly ticked, which is the check that matters here.
  function send() {
    if (live.length === 0) return;
    setResult(null);
    startTransition(async () => {
      const res = await sendPosToTeam(live);
      setResult({ sent: res.sent, error: res.error, failures: res.failures });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <SelectionContext.Provider value={{ selected, toggle, pending }}>
      {draftIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-neutral-50 px-4 py-2 text-xs dark:border-white/10 dark:bg-neutral-900">
          <span className="text-neutral-500">
            {live.length === 0
              ? `${draftIds.length} draft(s) ready to send`
              : `${live.length} selected`}
          </span>
          <button
            type="button"
            onClick={live.length === draftIds.length ? () => setSelected(new Set()) : allOn}
            disabled={pending}
            className="rounded-md border border-black/10 px-2 py-1 hover:bg-white disabled:opacity-40 dark:border-white/15 dark:hover:bg-neutral-800"
          >
            {live.length === draftIds.length ? "Clear selection" : "Select all drafts"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={pending || live.length === 0}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            {pending ? "Sending…" : `Send ${live.length || ""} selected`.trim()}
          </button>

          {result && (
            <span className="w-full">
              {result.sent > 0 && (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {result.sent} PO(s) sent to the PO team.
                </span>
              )}
              {result.error && (
                <span className="ml-2 text-rose-600 dark:text-rose-400">
                  {result.error}
                </span>
              )}
              {/* Per PO, because the reasons differ and a single summary would
                  leave the buyer opening each one to find out which. */}
              {result.failures.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-rose-600 dark:text-rose-400">
                  {result.failures.map((f) => (
                    <li key={f.poId}>
                      <span className="font-mono">{f.poId.slice(0, 8)}</span> —{" "}
                      {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </span>
          )}
        </div>
      )}
      {children}
    </SelectionContext.Provider>
  );
}

/** The checkbox on one draft. Renders nothing for a PO already sent. */
export function SelectPo({ poId, draft }: { poId: string; draft: boolean }) {
  const ctx = useContext(SelectionContext);
  if (!ctx || !draft) return null;
  return (
    <input
      type="checkbox"
      aria-label="Select this PO for sending"
      checked={ctx.selected.has(poId)}
      disabled={ctx.pending}
      onChange={() => ctx.toggle(poId)}
      className="size-4 accent-indigo-600"
    />
  );
}
