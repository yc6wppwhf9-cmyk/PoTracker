"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPoToTeam, updatePoDetails } from "../actions";
import { SITES } from "@/lib/sites";

/**
 * ETD and delivery site on an unsent draft.
 *
 * One submit can produce several drafts sharing the same values, and different
 * suppliers rarely deliver on the same day — so they are editable here, right
 * up until the PO is sent.
 */
export function PoDetailsFields({
  poId,
  etd,
  site,
}: {
  poId: string;
  etd: string | null;
  site: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localEtd, setLocalEtd] = useState(etd ?? "");
  const [localSite, setLocalSite] = useState(site ?? "");

  function save(nextEtd: string, nextSite: string) {
    setError(null);
    startTransition(async () => {
      const res = await updatePoDetails(poId, nextEtd || null, nextSite || null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const cls =
    "rounded-md border border-black/10 bg-white px-2 py-1 text-xs disabled:opacity-40 dark:border-white/15 dark:bg-neutral-950";

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
      <label className="flex items-center gap-1">
        ETD
        <input
          type="date"
          value={localEtd}
          disabled={pending}
          onChange={(e) => {
            setLocalEtd(e.target.value);
            save(e.target.value, localSite);
          }}
          className={cls}
        />
      </label>
      <label className="flex items-center gap-1">
        Site
        <select
          value={localSite}
          disabled={pending}
          onChange={(e) => {
            setLocalSite(e.target.value);
            save(localEtd, e.target.value);
          }}
          className={`max-w-[15rem] ${cls}`}
        >
          <option value="">— select —</option>
          {SITES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {error && <span className="text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  );
}

/**
 * Hands a draft to the PO team. Until this is pressed the PO is the buyer's
 * alone — invisible downstream and silent — so the button carries the whole
 * weight of the handover and says what it will do before doing it.
 */
export function SendPoBtn({
  poId,
  supplier,
  lineCount,
}: {
  poId: string;
  supplier: string | null;
  lineCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSend() {
    setError(null);
    const who = supplier ? `for ${supplier}` : "";
    if (
      !confirm(
        `Send this PO ${who} (${lineCount} line(s)) to the PO team?\n\n` +
          "They will be emailed and can then attach the signed document. " +
          "You will not be able to edit it afterwards."
      )
    )
      return;

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
        onClick={onSend}
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send to PO team"}
      </button>
    </span>
  );
}
