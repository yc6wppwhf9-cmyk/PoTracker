"use client";

import { useState } from "react";
import { ReconTabs } from "@/components/recon/recon-tabs";
import { STATUS_META, type ReconRow, type ReconStatus } from "@/lib/reconciliation";
import { EscalationPanel } from "./escalation-panel";

/**
 * The reconciliation table with the escalation panel attached to it.
 *
 * The panel used to sit permanently below the table listing every flagged line
 * on the sheet — on a real sheet, thousands of rows and a warning about 1,670
 * more, displayed whether or not anyone had asked. It now follows the KPI card
 * the approver selects and shows only that status.
 *
 * The two are joined here rather than in ReconTabs so the shared table stays
 * unaware of escalation, which is specific to the approver.
 */
export function ReconWithEscalation({
  rows,
  sheetId,
}: {
  rows: ReconRow[];
  sheetId: string;
}) {
  const [active, setActive] = useState<ReconStatus | undefined>(undefined);

  // Nothing to escalate about a line that is on target, and a status with no
  // rows has nothing to show either.
  const escalatable =
    active != null &&
    active !== "on_target" &&
    rows.some((r) => r.status === active);

  return (
    <>
      <ReconTabs rows={rows} active={active} onActiveChange={setActive} />
      {escalatable && (
        <div className="mt-10">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
            {STATUS_META[active].label}
          </p>
          <EscalationPanel sheetId={sheetId} status={active} />
        </div>
      )}
    </>
  );
}
