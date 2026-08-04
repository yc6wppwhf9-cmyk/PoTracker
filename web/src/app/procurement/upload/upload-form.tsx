"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postForm } from "@/lib/api";

type UploadResult = {
  rm_sheet_id: string;
  idempotent: boolean;
  filename?: string;
  style_ref?: string;
  lines?: number;
  matched?: number;
  unresolved?: number;
  needs_review?: number;
  skipped?: number;
  distinct_items?: number;
  auto_registered_items?: number;
  auto_pos_created?: number;
  auto_lines_inserted?: number;
  storage_ok?: boolean;
  message?: string;
  reparsable?: boolean;
  warnings?: string[];
};

export function UploadForm() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  // Held so an already-uploaded sheet can be re-parsed without asking the user
  // to pick the same file again.
  const [lastFile, setLastFile] = useState<File | null>(null);

  async function send(file: File, reparse: boolean) {
    setFileName(file.name);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (reparse) fd.append("reparse", "true");
      const res = await postForm<UploadResult>("/rm-sheets", fd);
      setResult(res);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  // Parsing starts the moment a file is chosen — there is no second step. The
  // reference is assigned server-side (MR-<year>-NNN), so nothing else is
  // needed from the uploader.
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-picking the same file after a failure: without clearing the
    // input, choosing it again fires no change event.
    e.target.value = "";
    if (!file) return;

    setLastFile(file);
    await send(file, false);
  }

  return (
    <div className="max-w-xl">
      <div className="rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-neutral-900">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">RM sheet (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={onFileChosen}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50 dark:file:bg-white dark:file:text-neutral-900"
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          Parsing starts as soon as you choose a file.
        </p>

        {busy && (
          <p className="mt-4 flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
            Uploading &amp; parsing{fileName ? ` “${fileName}”` : ""}…
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950/40">
          {result.idempotent ? (
            <div>
              <p className="text-sm text-green-800 dark:text-green-300">
                {result.message ?? "This sheet was already uploaded."} (sheet{" "}
                <code>{result.rm_sheet_id.slice(0, 8)}</code>)
              </p>
              {result.reparsable && lastFile && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send(lastFile, true)}
                    className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                  >
                    {busy ? "Re-parsing…" : "Re-parse this sheet"}
                  </button>
                  <p className="mt-2 text-xs text-green-800/80 dark:text-green-300/80">
                    Rebuilds the requirement lines from the same file using the
                    current rules. Purchase orders already raised are kept, but
                    buyer assignments on this sheet are cleared and must be
                    redone.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-green-900 dark:text-green-200">
                Parsed “{result.filename}”
                {result.style_ref ? (
                  <span className="ml-2 font-mono text-xs font-normal text-green-700 dark:text-green-400">
                    {result.style_ref}
                  </span>
                ) : null}
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <Stat label="Lines" value={result.lines} />
                <Stat label="Distinct items" value={result.distinct_items} />
                <Stat label="Zero-qty rows dropped" value={result.skipped} />
                {!!result.auto_pos_created && (
                  <Stat label="POs from sheet" value={result.auto_pos_created} />
                )}
                <Stat
                  label="File stored"
                  value={result.storage_ok ? "yes" : "no"}
                />
              </dl>

              {/* Only surfaced when a line genuinely cannot reconcile. Codes
                  registered from the sheet are treated as matched and are not
                  the uploader's problem. */}
              {!!result.unresolved && result.unresolved > 0 && (
                <p className="mt-3 text-xs text-red-700 dark:text-red-400">
                  {result.unresolved} line(s) have an item code that could not
                  be added to the catalogue — they will not reconcile. Ask an
                  admin to check the item catalogue.
                </p>
              )}

              {!!result.warnings?.length && (
                <ul className="mt-3 space-y-1 border-t border-green-200 pt-3 text-xs text-neutral-600 dark:border-green-900 dark:text-neutral-400">
                  {result.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
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
