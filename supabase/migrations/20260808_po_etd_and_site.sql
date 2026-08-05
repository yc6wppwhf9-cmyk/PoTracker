-- The buyer records, per purchase order, when the material is expected and
-- which site it is delivered to.
--
-- Both live on `po` rather than `po_line`: a PO is issued to one supplier for
-- one delivery, and drafts are already split one per supplier, so a per-line
-- date would be repeated identically down every row of the order.
--
-- Nullable, because a draft is raised before these are always known. They are
-- required at the point the buyer sends the PO to the PO team, which is
-- enforced in sendPoToTeam rather than here — a NOT NULL would make it
-- impossible to save a partially-filled draft at all.

alter table public.po
  add column if not exists etd  date,
  add column if not exists site text;

comment on column public.po.etd is
  'Estimated time of delivery for this purchase order, set by the buyer.';
comment on column public.po.site is
  'Delivery site. Chosen from the fixed list in web/src/lib/sites.ts.';

-- No RLS change is needed: po_update already allows the creating buyer while
-- the PO is still a draft, and the PO team thereafter.
