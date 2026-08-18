/**
 * Bill-to locations a buyer can choose when raising a purchase order.
 *
 * The dropdown is intentionally fixed so the document can be matched to a
 * known legal address without free-form typos.
 */
export const BILL_TO_SITES: readonly string[] = [
  "High Spirit Commercial Ventures Pvt Ltd - Muzaffarpur",
  "High Spirit Commercial Ventures Pvt Ltd - Bhiwandi",
] as const;

export const SITES = BILL_TO_SITES;

/**
 * The distinguishing part of a site name, for tables where the full legal name
 * would swamp the column — every site shares the same 38-character prefix.
 */
export function shortSite(site: string | null | undefined): string {
  if (!site) return "—";
  const dash = site.lastIndexOf(" - ");
  return dash === -1 ? site : site.slice(dash + 3);
}

/** True when a bill-to value is one this list still offers. */
export function isKnownBillTo(value: string | null | undefined): boolean {
  return !!value && BILL_TO_SITES.includes(value);
}

/** Backwards-compatible alias for older code paths still using the previous name. */
export function isKnownSite(value: string | null | undefined): boolean {
  return isKnownBillTo(value);
}
