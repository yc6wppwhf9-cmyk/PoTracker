-- ETD and delivery site belong to the item, not the order.
--
-- They were set once per PO, which assumed every line on an order lands at the
-- same site on the same day. It does not: a single supplier's order is
-- routinely split across Bhiwandi and Muzaffarpur with different dates, and a
-- PO-level value forced the buyer to either split the draft or record something
-- untrue. What the approver then read as "ETD" was whichever value happened to
-- apply to some of it.
--
-- po.etd and po.site are kept. They are what the PO document itself carries and
-- what every existing screen and export reads, so removing them here would
-- break those in the same change that fixes this. They now mean "the value for
-- this order as a whole, where there is one" — see the view below.

alter table public.po_line
  add column if not exists etd  date,
  add column if not exists site text;

comment on column public.po_line.etd is
  'Expected delivery date for this line. Falls back to po.etd when not set.';
comment on column public.po_line.site is
  'Delivery site for this line. Falls back to po.site when not set.';

-- Carry the existing PO-level values down, so nothing already entered is lost
-- and every current line keeps the date and site it was sent with.
update public.po_line l
   set etd  = coalesce(l.etd,  p.etd),
       site = coalesce(l.site, p.site)
  from public.po p
 where p.id = l.po_id
   and (l.etd is null or l.site is null)
   and (p.etd is not null or p.site is not null);

-- The order-level value, for the places that still need one: the single value
-- if every line agrees, otherwise null. Guessing on behalf of the reader —
-- picking the earliest date, say — would put a number on a document that no
-- line actually promised.
create or replace view public.po_delivery
with (security_invoker = true)
as
  select
    p.id as po_id,
    case when count(distinct l.etd)  = 1 then min(l.etd)  end as etd,
    case when count(distinct l.site) = 1 then min(l.site) end as site,
    count(distinct l.etd)  as distinct_etds,
    count(distinct l.site) as distinct_sites
  from public.po p
  left join public.po_line l on l.po_id = p.id
  group by p.id;

comment on view public.po_delivery is
  'Order-level ETD and site: the agreed value when every line shares one, null
   when they differ. security_invoker so the caller''s policies on po and
   po_line still apply.';

create index if not exists po_line_po_id_idx on public.po_line (po_id);
