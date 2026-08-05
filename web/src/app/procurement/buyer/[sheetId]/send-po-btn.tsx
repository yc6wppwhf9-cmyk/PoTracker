"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPoToTeam } from "../actions";

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
