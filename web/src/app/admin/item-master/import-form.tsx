"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postForm } from "@/lib/api";

type ImportResult = { imported: number; skipped: number };

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm<ImportResult>("/item-master/import", fd);
      setResult(res);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
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
          <span className="mb-1 block text-sm font-medium">
            Catalogue file (.xlsx)
          </span>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:file:bg-white dark:file:text-neutral-900"
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          Recognised columns: Item Code, Item Name, Category, Base Unit, MOQ.
          Rows are upserted by item code.
        </p>

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
          {busy ? "Importing…" : "Import catalogue"}
        </button>
      </form>

      {result && (
        <p className="mt-6 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
          Imported {result.imported} item(s), skipped {result.skipped}.
        </p>
      )}
    </div>
  );
}
