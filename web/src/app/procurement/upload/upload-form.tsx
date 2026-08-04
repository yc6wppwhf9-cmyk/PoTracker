"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postForm } from "@/lib/api";

type UploadResult = {
  rm_sheet_id: string;
  idempotent: boolean;
  filename?: string;
  lines?: number;
  matched?: number;
  needs_review?: number;
  skipped?: number;
  distinct_items?: number;
  storage_ok?: boolean;
  message?: string;
};

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [styleRef, setStyleRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (styleRef.trim()) fd.append("style_ref", styleRef.trim());
      const res = await postForm<UploadResult>("/rm-sheets", fd);
      setResult(res);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-neutral-900"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">RM sheet (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:file:bg-white dark:file:text-neutral-900"
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium">
            Style reference <span className="text-neutral-400">(optional)</span>
          </span>
          <input
            type="text"
            value={styleRef}
            onChange={(e) => setStyleRef(e.target.value)}
            placeholder="e.g. STYLE-2026-014"
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-neutral-950"
          />
        </label>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!file || busy}
          className="mt-5 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {busy ? "Uploading & parsing…" : "Upload & parse"}
        </button>
      </form>

      {result && (
        <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950/40">
          {result.idempotent ? (
            <p className="text-sm text-green-800 dark:text-green-300">
              {result.message ?? "This sheet was already uploaded."} (sheet{" "}
              <code>{result.rm_sheet_id.slice(0, 8)}</code>)
            </p>
          ) : (
            <>
              <h3 className="font-semibold text-green-900 dark:text-green-200">
                Parsed “{result.filename}”
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <Stat label="Lines" value={result.lines} />
                <Stat label="Matched" value={result.matched} />
                <Stat label="Needs review" value={result.needs_review} />
                <Stat label="Distinct items" value={result.distinct_items} />
                <Stat label="Skipped" value={result.skipped} />
                <Stat
                  label="File stored"
                  value={result.storage_ok ? "yes" : "no"}
                />
              </dl>
              {!!result.needs_review && result.needs_review > 0 && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                  {result.needs_review} line(s) had an item code not in the
                  catalogue — they’ll be resolved via fuzzy matching (Phase 7).
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="text-lg font-semibold">{value ?? "—"}</dd>
    </div>
  );
}
