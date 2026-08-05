-- DO NOT APPLY BLIND. Run supabase/INSPECT.sql first.
--
-- Query 0 there reports whether `reconciliation` exists and under which schema.
--   * If it returns a row  -> the view already exists; DO NOT run this file.
--     Paste its definition instead so the app can be matched to the real one.
--   * If it returns nothing -> the view is missing, every screen that reads it
--     has been returning nothing, and this file creates it.
--
-- Six call sites depend on this relation:
--   web  /procurement/reconciliation/[sheetId], /approver/[sheetId] (+ its
--        escalation panel), /md/[sheetId], approver/actions.ts
--   api  routers/exports.py (the KPI workbook), routers/ai.py
--
-- The column list below is fixed by web/src/lib/database.types.ts; changing a
-- name or type here breaks those call sites and the generated types.

create or replace view public.reconciliation
with (security_invoker = true)   -- callers see only rows their RLS allows
as
with req as (
  -- One row per material per sheet. The sheet can list the same item under
  -- several source rows, so demand is summed.
  select r.rm_sheet_id,
         r.item_code,
         r.lot,
         r.location,
         sum(r.required_qty)::numeric as required
  from public.rm_requirement r
  where r.item_code is not null
  group by r.rm_sheet_id, r.item_code, r.lot, r.location
),
ord as (
  -- Ordered quantity for the same key. MOQ lives on po_line (it is supplier
  -- specific and is NOT in item_master), so the largest MOQ committed against
  -- the material is the one that constrained the buy.
  select p.rm_sheet_id,
         l.item_code,
         l.lot,
         l.location,
         sum(l.ordered_qty)::numeric   as ordered,
         max(coalesce(l.moq, 0))::numeric as moq
  from public.po_line l
  join public.po p on p.id = l.po_id
  where l.item_code is not null
  group by p.rm_sheet_id, l.item_code, l.lot, l.location
),
j as (
  -- FULL JOIN: a material can be required but never ordered (not_bought), or
  -- ordered without appearing on the sheet (extra_not_in_sheet).
  select
    coalesce(rq.rm_sheet_id, od.rm_sheet_id) as rm_sheet_id,
    coalesce(rq.item_code,   od.item_code)   as item_code,
    coalesce(rq.lot,         od.lot)         as lot,
    coalesce(rq.location,    od.location)    as location,
    coalesce(rq.required, 0)                 as required,
    coalesce(od.ordered,  0)                 as ordered,
    coalesce(od.moq,      0)                 as moq,
    rq.item_code is not null                 as on_sheet
  from req rq
  full join ord od
    on  od.rm_sheet_id = rq.rm_sheet_id
    and od.item_code   = rq.item_code
    and od.lot      is not distinct from rq.lot        -- NULL lot must match
    and od.location is not distinct from rq.location   -- NULL location too
),
d as (
  select j.*,
         -- Buying in MOQ multiples cannot land exactly on the requirement;
         -- the smallest legal buy that still covers it is the ceiling.
         case when j.moq > 0
              then ceil(j.required / j.moq) * j.moq
              else j.required
         end as expected_max
  from j
)
select
  d.rm_sheet_id,
  d.item_code,
  im.name,
  im.category,
  im.base_unit,
  d.lot,
  d.location,
  d.required,
  d.ordered,
  d.moq,
  d.expected_max,
  -- Slack the MOQ legitimately allows above the requirement.
  (d.expected_max - d.required)          as tol,
  (d.ordered - d.required)               as variance,
  -- True when the excess is explained entirely by the MOQ rounding, so a
  -- reviewer can separate "unavoidable" from "genuine" over-buy.
  (d.moq > 0 and d.ordered > d.required and d.ordered <= d.expected_max) as moq_forced,
  case
    when not d.on_sheet          then 'extra_not_in_sheet'
    when d.ordered = 0           then 'not_bought'
    when d.ordered < d.required  then 'partial'
    when d.ordered > d.expected_max then 'over_buy'
    else 'on_target'
  end as status
from d
left join public.item_master im on im.item_code = d.item_code;

comment on view public.reconciliation is
  'Per-material comparison of sheet demand against ordered quantity, keyed on
   (rm_sheet_id, item_code, lot, location). security_invoker keeps RLS on the
   underlying tables in force.';

-- The view inherits RLS from its base tables via security_invoker, but the
-- roles still need to be able to select from the view itself.
grant select on public.reconciliation to authenticated;
