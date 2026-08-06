"use client";

import { useState, type ReactNode } from "react";

export type ApproverTab = {
  key: string;
  label: string;
  /** Shown as a badge. Omitted when there is nothing to count. */
  count?: number;
  /** Draws attention when non-zero — an over-receipt is money, not a total. */
  alert?: boolean;
  content: ReactNode;
};

/**
 * The approver's three jobs, kept apart.
 *
 * They were one long page, so approving a sheet — the only action on it —
 * meant scrolling past two monitoring sections that need watching but not
 * doing. Panels are rendered on the server and passed in as content, so
 * switching tabs costs nothing and no data is fetched twice.
 */
export function ApproverTabs({ tabs }: { tabs: ApproverTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="mb-5 inline-flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              active === t.key
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
                  t.alert
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Every panel is rendered; only one is shown. Keeping them mounted means
          a tab's own state — the pending list's filter, an expanded row —
          survives switching away and back. */}
      {tabs.map((t) => (
        <div key={t.key} hidden={t.key !== current?.key}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
