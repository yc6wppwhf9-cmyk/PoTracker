-- Keep every receipt line; show only the ones we can act on.
--
-- The previous approach discarded lines whose PO number was not in `po`. That
-- gave a clean register but had a hole that loses data: a receipt arriving
-- before the PO team captured the number off the document was dropped and
-- never retried, because the next register carries a GRC we then have no
-- record of having seen. The material would show as never delivered.
--
-- Storing everything and filtering at read time has neither problem. A late
-- PO number makes its receipts appear retrospectively — the row was there all
-- along, it simply had nothing to match.
--
-- Matched on PO number because it is the only thing this system and Ginesys
-- share. Trimmed and upper-cased on both sides: the two are typed by different
-- people into different systems.

create or replace view public.grn_ours
with (security_invoker = true)
as
  select g.*
  from public.grn g
  where exists (
    select 1
    from public.po p
    where p.po_number is not null
      and g.po_number is not null
      and upper(btrim(p.po_number)) = upper(btrim(g.po_number))
  );

comment on view public.grn_ours is
  'Receipts against purchase orders raised in this system. The register that
   arrives by email is company-wide; this is the part that can be reconciled.
   Everything is still stored in `grn`, so a PO number captured later brings
   its receipts into view rather than having lost them. security_invoker, so
   the caller''s policies on grn and po still apply.';

-- The view''s EXISTS runs per row, on both sides of the comparison.
create index if not exists po_po_number_upper_idx
  on public.po (upper(btrim(po_number)))
  where po_number is not null;

-- grn already has grn_po_number_idx on upper(btrim(po_number)).

-- Verify — the second number is what the register screens now show:
--   select (select count(*) from public.grn)      as all_receipts,
--          (select count(*) from public.grn_ours) as ours;
