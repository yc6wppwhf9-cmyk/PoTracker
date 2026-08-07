export type ReconStatus =
  | "on_target"
  | "partial"
  | "over_buy"
  | "not_bought"
  | "drafted_only"
  | "extra_not_in_sheet";

export type ReconRow = {
  rm_sheet_id: string | null;
  item_code: string | null;
  lot: string | null;
  location: string | null;
  name: string | null;
  category: string | null;
  base_unit: string | null;
  required: number | null;
  /** Ordered for real — sent to the PO team or already documented. */
  ordered: number | null;
  /** Sitting in an unsent draft. Not ordered: no supplier has been told, and
   *  abandoning it costs nothing. Shown so a buyer can see their own work in
   *  progress without it counting as bought. */
  drafted: number | null;
  moq: number | null;
  expected_max: number | null;
  tol: number | null;
  variance: number | null;
  status: string | null;
  moq_forced: boolean | null;
};

// `token` maps to the CSS vars --st-<token> and --st-<token>-tint in globals.css.
export const STATUS_META: Record<
  ReconStatus,
  { label: string; short: string; token: string }
> = {
  over_buy: { label: "Over-buy", short: "genuine over-order", token: "critical" },
  partial: { label: "Partial", short: "under-bought", token: "warn" },
  not_bought: { label: "Not bought", short: "no PO yet", token: "pending" },
  drafted_only: {
    label: "Pending",
    short: "raised, not sent",
    token: "pending",
  },
  extra_not_in_sheet: { label: "Extra", short: "not on the sheet", token: "serious" },
  on_target: { label: "On target", short: "within tolerance", token: "good" },
};

export const STATUS_ORDER: ReconStatus[] = [
  "over_buy",
  "partial",
  "not_bought",
  "drafted_only",
  "extra_not_in_sheet",
  "on_target",
];

export function statusVar(token: string): string {
  return `var(--st-${token})`;
}
export function statusTint(token: string): string {
  return `var(--st-${token}-tint)`;
}

export function isReconStatus(s: string | null): s is ReconStatus {
  return s != null && s in STATUS_META;
}
