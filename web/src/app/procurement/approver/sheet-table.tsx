"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";

type Sheet = {
  id: string;
  style_ref: string | null;
  status: string;
  created_at: string;
  sentToMdAt: string | null;
  mdDecision: string | null;
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
      <div className="relative mb-3 w-72 max-w-full">
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

      <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-white/[0.06]">
            <tr>
              <th className="px-4 py-3 font-medium">Sheet</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Uploaded</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.id}
                className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.05]"
              >
                <td className="px-4 py-3 font-medium">
                  {s.style_ref ?? `Sheet ${s.id.slice(0, 8)}`}
                </td>
                <td className="px-4 py-3">
                  {/* Where it stands with the MD matters more than the
                      sheet's own status, which says nothing about approval. */}
                  {s.sentToMdAt ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.mdDecision === "approved"
                          ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                          : s.mdDecision === "rejected"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                      }`}
                    >
                      {s.mdDecision === "pending"
                        ? "with the MD"
                        : `MD ${s.mdDecision}`}
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                      {s.status}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-500">
                  {formatDateTime(s.created_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/procurement/approver/${s.id}`}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                  >
                    {s.sentToMdAt ? "View" : "Review"}
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  {sheets.length === 0
                    ? "No sheets yet."
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
