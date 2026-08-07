"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPoToTeam, updatePoLineDetails } from "../actions";
import { SITES, shortSite } from "@/lib/sites";

const FIELD =
  "rounded-md border border-black/10 bg-white px-2 py-1 text-xs disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950";

/**
 * ETD and delivery site for one line of a draft, edited in place in the items
 * table.
 *
 * Per line, not per PO: a single supplier's order is routinely split across
 * sites and dates, and one value for the whole order made the buyer either
 * split the draft or record something untrue.
 *
 * Saved on change rather than behind a button. There is no submit for the
 * table as a whole, so an unsaved edit would be lost silently on navigation —
 * and a date the buyer believes they set is worse than one they know they
 * have not.
 */
export function LineDeliveryFields({
  lineId,
  etd,
  site,
  editable,
}: {
  lineId: string;
  etd: string | null;
  site: string | null;
  /** Sent POs are read-only; the values still show. */
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localEtd, setLocalEtd] = useState(etd ?? "");
  const [localSite, setLocalSite] = useState(site ?? "");

  function save(nextEtd: string, nextSite: string) {
    setError(null);
    startTransition(async () => {
      const res = await updatePoLineDetails(
        lineId,
        nextEtd || null,
        nextSite || null
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  if (!editable) {
    return (
      <>
        <td className="px-3 py-2 text-neutral-500">
          {etd ? new Date(etd).toLocaleDateString("en-GB") : "—"}
        </td>
        <td className="px-3 py-2 text-neutral-500">{shortSite(site)}</td>
      </>
    );
  }

  return (
    <>
      <td className="px-3 py-2">
        <input
          type="date"
          aria-label="Expected delivery date"
          value={localEtd}
          disabled={pending}
          onChange={(e) => {
            setLocalEtd(e.target.value);
            save(e.target.value, localSite);
          }}
          className={FIELD}
        />
      </td>
      <td className="px-3 py-2">
        <select
          aria-label="Delivery site"
          value={localSite}
          disabled={pending}
          onChange={(e) => {
            setLocalSite(e.target.value);
            save(localEtd, e.target.value);
          }}
          className={`max-w-[11rem] ${FIELD}`}
        >
          <option value="">— select —</option>
          {SITES.map((s) => (
            <option key={s} value={s}>
              {shortSite(s)}
            </option>
          ))}
        </select>
        {error && (
          <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}
      </td>
    </>
  );
}

/**
 * Hands a draft to the PO team. Until this is pressed the PO is the buyer's
 * alone — invisible downstream and silent — so the button carries the whole
 * weight of the handover.
 *
 * The browser's confirm() dialog is gone: it interrupted the buyer on every
 * single PO, and a sheet produces one per supplier. The button confirms itself
 * instead — the first click turns it into "Confirm send", the second sends.
 * Same protection against a stray click, no modal, and it cannot be dismissed
 * by muscle memory the way a native dialog can.
 */
export function SendPoBtn({ poId }: { poId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  function onClick() {
    setError(null);
    if (!armed) {
      setArmed(true);
      return;
    }
    startTransition(async () => {
      const res = await sendPoToTeam(poId);
      setArmed(false);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-2">
      {error && (
        <span className="max-w-md text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
      {armed && !pending && (
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          Cancel
        </button>
      )}
      <button
        type="button"
        onClick={onClick}
        onBlur={() => setArmed(false)}
        disabled={pending}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
          armed
            ? "bg-rose-600 hover:bg-rose-500"
            : "bg-indigo-600 hover:bg-indigo-500"
        }`}
      >
        {pending ? "Sending…" : armed ? "Confirm send" : "Send to PO team"}
      </button>
    </span>
  );
}
