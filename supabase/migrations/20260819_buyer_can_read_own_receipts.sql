-- A buyer may read the receipts against their own purchase orders.
--
-- `grn_select` was `is_staff()`, and a buyer is not staff. That is not merely a
-- missing feature: every screen that measures delivery against a PO reads the
-- GRN rows and subtracts them, so run as a buyer the subtraction found nothing
-- and reported the full quantity outstanding on lines that had already arrived.
-- Wrong numbers, no error, no clue — the worst shape a permission problem can
-- take.
--
-- Scoped to their own orders. A buyer sees what arrived against a PO they
-- raised, and nothing else: not another buyer's orders, not receipts for
-- material they never bought.
--
-- Matched on po_number because that is the only thing the two systems share.
-- The GRN register comes from Ginesys and carries no key of ours, which is why
-- reconciliation matches on (po_number, item_code) everywhere else too.

drop policy if exists grn_select on public.grn;

create policy grn_select
  on public.grn for select
  using (
    public.is_staff()
    or exists (
      select 1
      from public.po p
      where p.created_by = auth.uid()
        and p.po_number is not null
        and grn.po_number is not null
        and upper(btrim(p.po_number)) = upper(btrim(grn.po_number))
    )
  );

comment on policy grn_select on public.grn is
  'Staff see every receipt; a buyer sees receipts against purchase orders they
   raised, matched on PO number.';

-- The policy above filters on it for every row a buyer reads, and the pending
-- and receipt screens group by it.
create index if not exists grn_po_number_idx
  on public.grn (upper(btrim(po_number)));

-- Verify, signed in as a buyer:
--   select count(*) from public.grn;   -- their POs' receipts only
