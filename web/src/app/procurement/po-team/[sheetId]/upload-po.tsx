"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { postForm } from "@/lib/api";

export function UploadPo({ poId }: { poId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The document can attach successfully while the PO number does not — the
  // number belonging to another order does not make the attachment a failure.
  const [warning, setWarning] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm<{ warning?: string | null }>(
        `/pos/${poId}/upload`,
        fd
      );
      setWarning(res?.warning ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg"
        onChange={onChange}
        disabled={busy}
        className="hidden"
        id={`po-file-${poId}`}
      />
      <label
        htmlFor={`po-file-${poId}`}
        className="cursor-pointer rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Uploading…" : "Upload doc"}
      </label>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {warning && (
        <span className="max-w-md text-xs text-amber-700 dark:text-amber-400">
          {warning}
        </span>
      )}
    </span>
  );
}
