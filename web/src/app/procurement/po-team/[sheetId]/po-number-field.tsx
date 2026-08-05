"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePoNumber } from "../actions";

/**
 * The supplier-facing PO number, read off the attached document.
 *
 * Shown prominently because it is the identifier everything outside this system
 * uses — the supplier's invoice and the GRN register both refer to it, so a
 * missing or wrong one breaks goods-received matching later, long after anyone
 * still has the document open.
 */
export function PoNumberField({
  poId,
  value,
  hasDoc,
}: {
  poId: string;
  value: string | null;
  hasDoc: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePoNumber(poId, draft);
      if (res.error) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!hasDoc && !value) return null;

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">PO no.</span>
        {value ? (
          <span className="rounded border border-black/10 bg-neutral-50 px-1.5 py-0.5 font-mono font-semibold text-neutral-800 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-100">
            {value}
          </span>
        ) : (
          /* Amber, not silent: without this the PO cannot be matched to a GRN,
             and the document is only in front of someone once. */
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            not found on the document — add it
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
          className="text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {value ? "edit" : "add"}
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-500">PO no.</span>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="PO/HSM/00000910/26-27"
        className="w-56 rounded-md border border-black/10 bg-white px-2 py-1 font-mono text-xs dark:border-white/15 dark:bg-neutral-950"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded bg-neutral-900 px-2 py-1 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        className="text-neutral-500 hover:underline"
      >
        Cancel
      </button>
      {error && <span className="text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  );
}
