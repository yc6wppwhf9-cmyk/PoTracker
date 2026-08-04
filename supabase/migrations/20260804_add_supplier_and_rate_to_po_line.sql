-- Buyers record who they are ordering from and at what price, per item.
--
-- Both live on po_line rather than po: a single PO drafted from one RM sheet
-- can span several suppliers, and the rate is quoted per item ("rate per INV"),
-- not per order.
--
-- Nullable with no default: a draft may legitimately be raised before the
-- supplier is chosen or the price agreed, and a 0 default would be
-- indistinguishable from a genuinely free line.

alter table public.po_line
  add column if not exists supplier text,
  add column if not exists rate numeric;

comment on column public.po_line.supplier is
  'Supplier this line is ordered from. Entered by the buyer.';
comment on column public.po_line.rate is
  'Agreed price per unit in the item''s base unit. Line value = rate * ordered_qty.';
