/**
 * Delivery sites a buyer can choose when raising a purchase order.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EDIT THIS LIST to match your sites. It is the only place they are defined.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A fixed list was chosen over a database table deliberately: the names change
 * rarely, and a typed-in site would make grouping deliveries by site
 * unreliable. If they start changing often, this becomes a `site` table with an
 * admin screen, and only this file's readers need to change.
 *
 * Removing a site does not affect POs already raised against it — `po.site` is
 * free text, so historic orders keep the name they were saved with.
 */
export const SITES: readonly string[] = [
  "High Spirit Commercial Ventures Pvt Ltd - Bhiwandi",
  "High Spirit Commercial Ventures Pvt Ltd - Muzaffarpur",
  "High Spirit Commercial Ventures Pvt Ltd - Muzaffarpur II",
  "High Spirit Commercial Ventures Pvt Ltd - Patna",
] as const;

/**
 * The distinguishing part of a site name, for tables where the full legal name
 * would swamp the column — every site shares the same 38-character prefix.
 */
export function shortSite(site: string | null | undefined): string {
  if (!site) return "—";
  const dash = site.lastIndexOf(" - ");
  return dash === -1 ? site : site.slice(dash + 3);
}

/** True when a site is one this list still offers. */
export function isKnownSite(value: string | null | undefined): boolean {
  return !!value && SITES.includes(value);
}
