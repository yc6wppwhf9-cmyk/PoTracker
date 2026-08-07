"use client";

import { useState } from "react";
import { ReconTabs } from "@/components/recon/recon-tabs";
import { type ReconRow, type ReconStatus } from "@/lib/reconciliation";
import { EscalationPanel } from "./escalation-panel";

/**
 * The reconciliation table with the escalation panel attached to it.
 *
 * The panel used to sit permanently below the table listing every flagged line
 * on the sheet — on a real sheet, thousands of rows and a warning about 1,670
 * more, displayed whether or not anyone had asked. It now appears only when
 * the Not bought card is selected, and lists only those lines.
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

  // Not-bought only, by request. The other flagged statuses are escalatable in
  // principle — a partial or over-buy is the wrong quantity ordered — but in
  // practice the material nobody has ordered at all is what needs chasing, and
  // offering the panel on every card made it noise on the ones it was not
  // wanted for.
  const escalatable =
    active === "not_bought" && rows.some((r) => r.status === active);

  return (
    <>
      <ReconTabs rows={rows} active={active} onActiveChange={setActive} />
      {escalatable && (
        <div className="mt-10">
          <EscalationPanel sheetId={sheetId} status="not_bought" />
        </div>
      )}
    </>
  );
}
