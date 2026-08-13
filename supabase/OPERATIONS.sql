-- ============================================================================
--  PoTracker / PoIntelligence — Operations cookbook
-- ============================================================================
--  A reference of the queries that come up when running the procurement app by
--  hand: finding a sheet/item/receipt, assigning buyers (including a per-item
--  split), safe deletes, and health checks.
--
--  HOW TO USE
--    * Paste a block into the Supabase SQL editor (project "PoIntelligence").
--    * Every block that CHANGES data is preceded by a SELECT "preview" — run
--      that first and read it before running the UPDATE/DELETE.
--    * Replace the ALL-CAPS tokens:  <SHEET_REF>, <ITEM_CODE>, <BUYER_NAME>, …
--    * Destructive blocks are wrapped in BEGIN/COMMIT. Run through COMMIT only
--      once the row counts look right; ROLLBACK instead to back out.
--
--  KEY TABLES
--    rm_sheet         one requisition sheet (style_ref, status)
--    rm_requirement   one line of a sheet (item_code, department, required_qty,
--                     assigned_buyer, needs_review)
--    item_master      the catalogue (item_code → name, category, base_unit, moq)
--    po / po_line     purchase orders raised against a sheet
--    grn              goods received (per-receipt lines; grn_ours is the view)
--    profiles         users (id, full_name, email, role)
--    audit_log        who did what, when
--
--  MATCH KEYS
--    A receipt ties to a PO line by (po_number, item_code) — never by lot.
--    A requirement ties to the catalogue by item_code (NULL when unmatched).
-- ============================================================================


-- ============================================================================
--  1. ORIENTATION — find things
-- ============================================================================

-- 1.1  Recent sheets, with line + assignment counts.
select s.id, s.style_ref, s.status, s.created_at,
       count(r.*)                                              as lines,
       count(r.*) filter (where r.assigned_buyer is not null)  as assigned,
       count(r.*) filter (where r.item_code is null)           as unmatched
from public.rm_sheet s
left join public.rm_requirement r on r.rm_sheet_id = s.id
group by s.id
order by s.created_at desc
limit 20;

-- 1.2  One sheet by its reference (get its id for the blocks below).
select id, style_ref, status, created_at
from public.rm_sheet
where style_ref = '<SHEET_REF>';          -- e.g. 'MR-2026-001'

-- 1.3  Find an item in the catalogue (by code or name fragment).
select item_code, name, category, base_unit, moq
from public.item_master
where item_code ilike '<ITEM_CODE>'        -- exact-ish, e.g. 'INV20693'
   or name ilike '%<TEXT>%'                -- or a name fragment
order by item_code
limit 50;

-- 1.4  Find requisition lines by item code, across every sheet.
select r.id, s.style_ref, s.status, r.department, r.item_code, r.raw_code,
       r.raw_label, r.required_qty, r.lot, r.needs_review,
       coalesce(p.full_name, '(unassigned)') as buyer
from public.rm_requirement r
join public.rm_sheet s on s.id = r.rm_sheet_id
left join public.profiles p on p.id = r.assigned_buyer
where r.item_code ilike '<ITEM_CODE>' or r.raw_code ilike '<ITEM_CODE>'
order by s.created_at desc;

-- 1.5  Find a GRN receipt. doc_no is the supplier invoice no (e.g. 'AGS/189/26-27'),
--      grc_no the goods-receipt no (e.g. 'GRC/HSM/00001267/26-27').
select grc_no, grc_date, po_number, item_code, lot, item_name, qty,
       supplier, doc_no, doc_date, landed_cost
from public.grn
where doc_no      ilike '%<TEXT>%'
   or grc_no      ilike '%<TEXT>%'
   or po_number   ilike '%<TEXT>%'
order by grc_date desc nulls last
limit 100;


-- ============================================================================
--  2. ASSIGN BUYERS
-- ============================================================================
--  assigned_buyer on rm_requirement is a user id. Resolve names first, and
--  prefer name-based sub-selects over pasting UUIDs so these stay reusable.

-- 2.1  Who can be a buyer.
select id, full_name, email, role
from public.profiles
where role = 'buyer'
order by full_name;

-- 2.2  Assign a whole DEPARTMENT to a buyer, on one sheet.
--      Preview:
select department, count(*) as lines
from public.rm_requirement
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and department in ('<DEPT_A>', '<DEPT_B>')
group by department;
--      Apply:
update public.rm_requirement
set assigned_buyer = (select id from public.profiles
                      where full_name = '<BUYER_NAME>' and role = 'buyer')
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and department in ('<DEPT_A>', '<DEPT_B>');

-- 2.3  SPLIT one department between buyers by ITEM CODE (the "Runner" pattern).
--      Half the department's items go to one buyer, the rest to another.
update public.rm_requirement
set assigned_buyer = (select id from public.profiles where full_name = '<BUYER_1>')
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and department = '<DEPT>'
  and item_code in ('<CODE_1>', '<CODE_2>', '<CODE_3>');

update public.rm_requirement
set assigned_buyer = (select id from public.profiles where full_name = '<BUYER_2>')
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and department = '<DEPT>'
  and item_code in ('<CODE_4>', '<CODE_5>', '<CODE_6>');
--      NOTE: In the app's Assign screen, save a split from the "By INV code"
--      view, not the Category view — a category split shows blank there.
--      (The Category view now leaves a mixed group alone instead of wiping it.)

-- 2.4  Unassign a line / department (set buyer back to nobody).
update public.rm_requirement
set assigned_buyer = null
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and department = '<DEPT>';

-- 2.5  Flip the sheet to 'assigned' once every matched line has a buyer.
update public.rm_sheet s
set status = 'assigned'
where s.style_ref = '<SHEET_REF>'
  and not exists (
    select 1 from public.rm_requirement r
    where r.rm_sheet_id = s.id
      and r.item_code is not null
      and r.assigned_buyer is null
  );

-- 2.6  Per-buyer assignment summary for a sheet (the verification query).
select coalesce(p.full_name, '(unassigned)') as buyer, count(*) as lines
from public.rm_requirement r
left join public.profiles p on p.id = r.assigned_buyer
where r.rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
group by 1
order by 1;


-- ============================================================================
--  3. DELETE — carefully
-- ============================================================================

-- 3.1  Remove ONE requisition line. Preview first; keep the output as a record
--      so the line can be re-inserted if it was a mistake.
select id, rm_sheet_id, department, item_code, raw_label, required_qty, lot
from public.rm_requirement
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and item_code = '<ITEM_CODE>';
--      Check nothing was ordered against it before deleting:
select p.po_number, p.status, l.item_code, l.ordered_qty
from public.po p
join public.po_line l on l.po_id = p.id
where p.rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and l.item_code = '<ITEM_CODE>';
--      Delete (RETURNING echoes exactly what went):
begin;
delete from public.rm_requirement
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
  and item_code = '<ITEM_CODE>'
returning id, item_code, raw_label, required_qty;
-- commit;    -- uncomment to keep;  or:  rollback;

-- 3.2  Delete a whole SHEET and everything under it (requirements, POs,
--      approvals, escalations). Irreversible — mirror the app's cascade order.
--      The app refuses this once any line is assigned; do the same by hand.
begin;
with s as (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
delete from public.approval   where rm_sheet_id in (select id from s);
delete from public.escalation where rm_sheet_id in
  (select id from public.rm_sheet where style_ref = '<SHEET_REF>');
delete from public.po_line where po_id in
  (select p.id from public.po p
   join public.rm_sheet s on s.id = p.rm_sheet_id
   where s.style_ref = '<SHEET_REF>');
delete from public.po where rm_sheet_id in
  (select id from public.rm_sheet where style_ref = '<SHEET_REF>');
delete from public.rm_requirement where rm_sheet_id in
  (select id from public.rm_sheet where style_ref = '<SHEET_REF>');
delete from public.rm_sheet where style_ref = '<SHEET_REF>';
-- commit;    -- or rollback;


-- ============================================================================
--  4. HEALTH CHECKS & DIAGNOSTICS
-- ============================================================================

-- 4.1  Lines that need review (no catalogue match → item_code is NULL). These
--      drop out of reconciliation until the item is registered.
select s.style_ref, r.raw_code, r.raw_label, r.department, r.required_qty
from public.rm_requirement r
join public.rm_sheet s on s.id = r.rm_sheet_id
where r.item_code is null or r.needs_review
order by s.created_at desc;

-- 4.2  Assigned-but-unmatched, or matched-but-unassigned, on a sheet.
select
  count(*) filter (where item_code is null)                         as unmatched,
  count(*) filter (where item_code is not null and assigned_buyer is null) as matched_unassigned
from public.rm_requirement
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>');

-- 4.3  Over-delivery: received more than ordered (past a 2% tolerance).
--      Received is summed per (po_number, item_code) across all receipts.
with ordered as (
  select p.po_number, l.item_code, sum(l.ordered_qty) as ordered, max(l.rate) as rate
  from public.po p
  join public.po_line l on l.po_id = p.id
  where p.status <> 'draft' and p.po_number is not null
  group by p.po_number, l.item_code
),
received as (
  select po_number, item_code, sum(qty) as received
  from public.grn
  group by po_number, item_code
)
select o.po_number, o.item_code, o.ordered, r.received,
       (r.received - o.ordered)               as excess,
       round((r.received - o.ordered) * o.rate, 2) as excess_value
from ordered o
join received r
  on upper(r.po_number) = upper(o.po_number)
 and upper(coalesce(r.item_code,'')) = upper(coalesce(o.item_code,''))
where r.received > o.ordered * 1.02
order by excess_value desc nulls last;

-- 4.4  Outstanding / pending: ordered but not fully received (0.5% tolerance).
with ordered as (
  select p.po_number, l.item_code, l.supplier, l.etd,
         sum(l.ordered_qty) as ordered
  from public.po p
  join public.po_line l on l.po_id = p.id
  where p.status <> 'draft'
  group by p.po_number, l.item_code, l.supplier, l.etd
),
received as (
  select po_number, item_code, sum(qty) as received
  from public.grn group by po_number, item_code
)
select o.po_number, o.item_code, o.supplier, o.etd,
       o.ordered, coalesce(r.received, 0) as received,
       o.ordered - coalesce(r.received, 0) as outstanding,
       (o.etd is not null and o.etd < current_date) as overdue
from ordered o
left join received r
  on upper(r.po_number) = upper(o.po_number)
 and upper(coalesce(r.item_code,'')) = upper(coalesce(o.item_code,''))
where coalesce(r.received, 0) < o.ordered * 0.995
order by overdue desc, o.etd nulls last;

-- 4.5  GRN dashboard-style totals (what the dashboard tiles summarise).
select
  count(*)                                             as receipt_lines,
  count(distinct po_number)                            as pos_received_against,
  count(*) filter (where grc_date >= current_date - 7) as last_7_days,
  round(sum(qty), 2)                                   as qty_received,
  round(sum(coalesce(landed_cost, 0)), 2)              as value_received
from public.grn;

-- 4.6  Audit trail for a sheet (who assigned / notified / uploaded / deleted).
select a.created_at, coalesce(p.full_name, a.actor_id::text) as actor,
       a.action, a.detail
from public.audit_log a
left join public.profiles p on p.id = a.actor_id
where a.entity = 'rm_sheet'
  and a.entity_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
order by a.created_at desc;


-- ============================================================================
--  5. BUILT-IN VIEWS (read-only, already in the database)
-- ============================================================================
--  grn_ours        receipts filtered to our own POs — the GRN register screen.
--  reconciliation  required vs ordered vs drafted per (item_code, lot, location).

select * from public.grn_ours       order by grc_date desc limit 50;

select * from public.reconciliation
where rm_sheet_id = (select id from public.rm_sheet where style_ref = '<SHEET_REF>')
order by item_code, lot;
