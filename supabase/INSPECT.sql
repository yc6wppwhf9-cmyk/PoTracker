-- Run this whole file in the Supabase SQL Editor and paste the output back.
--
-- These are the last things about the live database that the application code
-- assumes but has never been able to read. Everything here is READ-ONLY.

-- 1. The reconciliation view.
--    Three screens, the KPI export, and the PO-team "Required" column all
--    assume it joins on (item_code, lot, location) and derives
--    expected_max = ceil(required/moq)*moq. If either assumption is wrong,
--    those screens are comparing the wrong things.
select pg_get_viewdef('public.reconciliation'::regclass, true) as reconciliation_view;

-- 2. Row-level security policies.
--    Confirms whether po_team can UPDATE po_line (the PO-team quantity editor)
--    and whether uploader can write item_master (auto-registration on upload).
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3. The scheduled jobs.
--    The 9-working-hour auto-escalation. If this already sends mail via pg_net,
--    the MD would get two notifications, not one.
select jobid, schedule, jobname, command
from cron.job
order by jobid;

-- 4. Which MOQ the view actually reads.
--    item_master.moq is 0 for every item (MOQ is not in your item master), so
--    a non-zero moq in the view can only come from po_line.
select
  (select count(*) from public.item_master where moq > 0) as item_master_with_moq,
  (select count(*) from public.po_line     where moq > 0) as po_line_with_moq;

-- 5. Sanity check on the current sheet: has it been re-parsed yet?
--    negative_lines should be 0 and null_item_code should be low after a
--    re-parse under the current rules.
select
  s.style_ref,
  count(r.id)                                          as lines,
  count(*) filter (where r.required_qty < 0)           as negative_lines,
  count(*) filter (where r.item_code is null)          as null_item_code,
  count(*) filter (where r.assigned_buyer is null)     as unassigned
from public.rm_sheet s
left join public.rm_requirement r on r.rm_sheet_id = s.id
group by s.id, s.style_ref
order by s.created_at desc;
