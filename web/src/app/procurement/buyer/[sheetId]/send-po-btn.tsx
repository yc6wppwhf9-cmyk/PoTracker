"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPoToTeam, updatePoLineDetails } from "../actions";
import { BILL_TO_SITES, shortSite } from "@/lib/sites";

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
  billTo,
  shipTo,
  editable,
}: {
  lineId: string;
  etd: string | null;
  billTo: string | null;
  shipTo: string | null;
  /** Sent POs are read-only; the values still show. */
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localEtd, setLocalEtd] = useState(etd ?? "");
  const [localBillTo, setLocalBillTo] = useState(billTo ?? "");
  const [localShipTo, setLocalShipTo] = useState(shipTo ?? "");

  function save(nextEtd: string, nextBillTo: string, nextShipTo: string) {
    setError(null);
    startTransition(async () => {
      const res = await updatePoLineDetails(
        lineId,
        nextEtd || null,
        nextBillTo || null,
        nextShipTo || null
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
        <td className="px-3 py-2 text-neutral-500">{shortSite(billTo)}</td>
        <td className="px-3 py-2 text-neutral-500">{shipTo || "—"}</td>
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
            save(e.target.value, localBillTo, localShipTo);
          }}
          className={FIELD}
        />
      </td>
      <td className="px-3 py-2">
        <select
          aria-label="Bill to"
          value={localBillTo}
          disabled={pending}
          onChange={(e) => {
            setLocalBillTo(e.target.value);
            save(localEtd, e.target.value, localShipTo);
          }}
          className={`max-w-[11rem] ${FIELD}`}
        >
          <option value="">— select —</option>
          {BILL_TO_SITES.map((s) => (
            <option key={s} value={s}>
              {shortSite(s)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          aria-label="Ship to"
          value={localShipTo}
          disabled={pending}
          onChange={(e) => {
            setLocalShipTo(e.target.value);
            save(localEtd, localBillTo, e.target.value);
          }}
          className={`max-w-[12rem] ${FIELD}`}
          placeholder="Ship to"
        />
      </td>
      {error && (
        <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Hands a draft to the PO team. Until this is pressed the PO is the buyer's
 * alone — invisible downstream and silent — so the button carries the whole
 * weight of the handover.
 *
 * One click sends. There was a browser confirm(), then a two-step arm-and-
 * confirm on the button; both were removed at the buyer's request. A sheet
 * produces one PO per supplier, so either one taxed every send to guard
 * against a mistake that is recoverable anyway — the PO team can be told
 * before they attach the document.
 */
export function SendPoBtn({ poId }: { poId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await sendPoToTeam(poId);
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
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send to PO team"}
      </button>
    </span>
  );
}
