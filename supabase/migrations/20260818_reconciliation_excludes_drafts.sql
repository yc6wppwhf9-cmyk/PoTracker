-- A draft is not an order.
--
-- Reconciliation summed every po_line regardless of the PO's status, so a
-- draft the buyer was still working on counted as bought. Half a requirement
-- ordered from one supplier and half sitting in an unsent draft read as
-- "on target" — the sheet said the material was covered when only half of it
-- had actually been ordered from anyone.
--
-- That is the wrong way round for a check whose entire job is to catch the
-- shortfall. A draft is private to the buyer: the PO team has not seen it, no
-- supplier has been told, and abandoning it costs nothing.
--
-- `ordered` now counts POs that have been placed (sent or uploaded). Drafts are
-- still visible, in their own `drafted` column, so the buyer can see what they
-- have already allocated and does not double-order — the reason they were
-- counted in the first place.

drop view if exists public.reconciliation;

create view public.reconciliation
with (security_invoker = true)
as
with req as (
  select rm_sheet_id, item_code, lot, location,
         sum(required_qty) as required
  from public.rm_requirement
  where item_code is not null
  group by rm_sheet_id, item_code, lot, location
),
ord as (
  select p.rm_sheet_id, l.item_code, l.lot, l.location,
         -- Placed. 'sent' means the PO team has it; 'uploaded' means the
         -- signed document is attached. Either way it has left the buyer.
         sum(l.ordered_qty) filter (where p.status <> 'draft') as ordered,
         sum(l.ordered_qty) filter (where p.status =  'draft') as drafted,
         max(nullif(l.moq, 0::numeric)) filter (where p.status <> 'draft') as po_moq
  from public.po_line l
  join public.po p on p.id = l.po_id
  where l.item_code is not null
  group by p.rm_sheet_id, l.item_code, l.lot, l.location
),
joined as (
  select
    coalesce(req.rm_sheet_id, ord.rm_sheet_id) as rm_sheet_id,
    coalesce(req.item_code,   ord.item_code)   as item_code,
    coalesce(req.lot,         ord.lot)         as lot,
    coalesce(req.location,    ord.location)    as location,
    coalesce(req.required, 0::numeric)         as required,
    coalesce(ord.ordered,  0::numeric)         as ordered,
    coalesce(ord.drafted,  0::numeric)         as drafted,
    ord.po_moq
  from req
  full join ord
    on req.rm_sheet_id = ord.rm_sheet_id
   and req.item_code   = ord.item_code
   and not req.lot      is distinct from ord.lot
   and not req.location is distinct from ord.location
),
calc as (
  select j.*,
         im.name, im.category, im.base_unit,
         coalesce(nullif(j.po_moq, 0::numeric), nullif(im.moq, 0::numeric), 0::numeric) as moq
  from joined j
  left join public.item_master im on im.item_code = j.item_code
)
select
  rm_sheet_id, item_code, lot, location, name, category, base_unit,
  required, ordered, drafted, moq,
  case when moq > 0::numeric then ceil(required / moq) * moq else required end as expected_max,
  greatest(required * 0.015, 2::numeric) as tol,
  round(ordered - required, 3) as variance,
  case
    -- Nothing placed, but a draft exists: distinct from "nobody has looked at
    -- this yet", and the difference decides whether anyone needs chasing.
    when required > 0::numeric and ordered = 0::numeric and drafted > 0::numeric
      then 'drafted_only'::text
    when required > 0::numeric and ordered = 0::numeric then 'not_bought'::text
    when required = 0::numeric and ordered > 0::numeric then 'extra_not_in_sheet'::text
    when ordered < (required - greatest(required * 0.015, 2::numeric)) then 'partial'::text
    when ordered > (
      case when moq > 0::numeric then ceil(required / moq) * moq else required end
      + greatest(required * 0.015, 2::numeric)
    ) then 'over_buy'::text
    else 'on_target'::text
  end as status,
  ordered > (required + greatest(required * 0.015, 2::numeric))
    and ordered <= (
      case when moq > 0::numeric then ceil(required / moq) * moq else required end
      + greatest(required * 0.015, 2::numeric)
    ) as moq_forced
from calc;

comment on view public.reconciliation is
  'Requirement against what has actually been ordered. Draft POs are reported
   separately in `drafted` and excluded from `ordered` — a draft is private to
   the buyer and commits nobody. security_invoker so RLS still applies.';

-- Verify — a requirement half ordered and half drafted must read 'partial':
--   select item_code, required, ordered, drafted, status
--   from public.reconciliation where required > 0 order by status;
