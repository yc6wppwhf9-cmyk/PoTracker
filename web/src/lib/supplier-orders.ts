import "server-only";
import { getPendingPos, type PendingLine } from "@/lib/pending-pos";

/**
 * Outstanding material grouped by supplier.
 *
 * Chasing happens in one phone call per supplier, not one per purchase order.
 * The pending list is deliberately flat — a PO total does not say which item is
 * short — but preparing that call from it means opening five POs and adding up
 * by hand. This is the same data, arranged the way the conversation happens.
 *
 * Built on getPendingPos rather than querying again so the two screens can
 * never disagree about what is outstanding.
 */

export type SupplierGroup = {
  supplier: string;
  lines: PendingLine[];
  /** Distinct purchase orders involved — what to quote on the call. */
  poNumbers: string[];
  items: number;
  outstanding: number;
  overdue: number;
  /** Days past ETD of the worst line; the reason to call today. */
  worstOverdue: number;
  /** Nothing at all has arrived on any line. */
  nothingReceived: boolean;
};

const UNNAMED = "— no supplier recorded —";

export async function getSupplierOrders(
  buyerId?: string
): Promise<SupplierGroup[]> {
  const lines = await getPendingPos(buyerId);

  const bySupplier = new Map<string, PendingLine[]>();
  for (const l of lines) {
    // A line with no supplier still has to be chased by somebody, so it is
    // grouped under a named bucket rather than dropped.
    const key = l.supplier?.trim() || UNNAMED;
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(l);
  }

  const groups: SupplierGroup[] = [...bySupplier.entries()].map(
    ([supplier, ls]) => ({
      supplier,
      lines: ls,
      poNumbers: [
        ...new Set(ls.map((l) => l.poNumber).filter((n): n is string => !!n)),
      ].sort(),
      items: ls.length,
      outstanding: ls.reduce((s, l) => s + l.outstanding, 0),
      overdue: ls.filter((l) => l.overdue).length,
      worstOverdue: ls.reduce((m, l) => Math.max(m, l.daysOverdue), 0),
      nothingReceived: ls.every((l) => l.nothingReceived),
    })
  );

  // Worst overdue first, then most outstanding — the order to work down.
  return groups.sort(
    (a, b) =>
      b.worstOverdue - a.worstOverdue ||
      b.overdue - a.overdue ||
      b.outstanding - a.outstanding
  );
}
