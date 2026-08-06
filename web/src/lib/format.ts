/**
 * Dates and times, rendered in the business's own timezone.
 *
 * Server Components format on the server, and the server runs in UTC — so
 * `new Date(x).toLocaleString()` showed every timestamp 5½ hours behind. A
 * sheet uploaded at 11:19 in the morning read as 05:49, and the dashboard
 * greeted people with "Good morning" at a quarter to one in the afternoon.
 *
 * Fixed to Asia/Kolkata rather than the viewer's locale on purpose: everyone
 * using this works to the same clock, and a fixed zone renders identically on
 * the server and the client, so there is no hydration mismatch and no flicker
 * from a value that changes once JavaScript loads.
 */
export const TIME_ZONE = "Asia/Kolkata";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** e.g. "06 Aug 2026, 12:46". Empty string for a missing value. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : DATE_TIME.format(d);
}

/** e.g. "06 Aug 2026". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : DATE_ONLY.format(d);
}

/** The hour of day in the business timezone, for a greeting that matches the
 *  clock on the wall rather than the server's. */
export function hourInBusinessZone(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(hour);
}
