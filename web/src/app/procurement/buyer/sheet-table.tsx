"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Sheet = {
  id: string;
  style_ref: string | null;
  status: string;
  lines: number;
};

export function SheetTable({ sheets }: { sheets: Sheet[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sheets;
    return sheets.filter((s) =>
      (s.style_ref ?? s.id).toLowerCase().includes(needle)
    );
  }, [sheets, q]);

  return (
    <>
      <div className="relative mt-6 w-72 max-w-full">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search MR number…"
          className="w-full rounded-md border border-black/10 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-white/15 dark:bg-neutral-950"
        />
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Sheet</th>
              <th className="px-4 py-3 font-medium">Your lines</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.id}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3 font-medium">
                  {s.style_ref ?? `Sheet ${s.id.slice(0, 8)}`}
                </td>
                <td className="px-4 py-3 text-neutral-500">{s.lines}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/procurement/buyer/${s.id}`}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  {sheets.length === 0
                    ? "Nothing assigned to you yet."
                    : `No sheets matching "${q}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
