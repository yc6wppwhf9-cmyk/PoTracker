"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postForm } from "@/lib/api";

export function ImportPoRegister({ sheetId }: { sheetId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    const form = new FormData();
    form.append("sheet_id", sheetId);
    form.append("file", file);

    try {
      const res = await postForm<{
        pos_created: number;
        lines_inserted: number;
        message: string;
      }>("/pos/import-register", form);

      setMessage(res.message);
      setFile(null);
      router.refresh();
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to import PO Register.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card mb-6 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
            Automated PO Register Upload (.xlsx)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Upload your company PO Register spreadsheet to automatically generate all POs and line items without manual entry.
          </p>
        </div>
      </div>

      <form onSubmit={handleImport} className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full max-w-xs cursor-pointer rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700 shadow-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:file:bg-indigo-950 dark:file:text-indigo-300"
        />

        <button
          type="submit"
          disabled={!file || loading}
          className="rounded-xl btn-gradient px-4 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Importing PO Register..." : "⚡ Import PO Register"}
        </button>
      </form>

      {message && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
          ✓ {message}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          ✕ {error}
        </div>
      )}
    </div>
  );
}
