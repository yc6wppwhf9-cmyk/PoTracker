-- Run this whole file in the Supabase SQL Editor and paste the output back.
-- Everything here is READ-ONLY.
--
-- NOTE: the editor runs the file as one batch and ABORTS AT THE FIRST ERROR,
-- so nothing below a failing statement returns. Every query here is therefore
-- written so it cannot error even when the object it asks about is missing.

-- 0. Does `reconciliation` exist at all, and where?
--    The app reads public.reconciliation from six places. A previous run of
--    this file reported: relation "public.reconciliation" does not exist.
--    This finds it under any schema, and shows what kind of object it is.
select n.nspname   as schema,
       c.relname   as name,
       case c.relkind when 'v' then 'view'
                      when 'm' then 'materialized view'
                      when 'r' then 'table'
                      when 'f' then 'foreign table'
                      else c.relkind::text end as kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relname ilike '%reconcil%'
order by 1, 2;

-- 0b. Everything the API can see in `public`, so we know what DOES exist.
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

-- 1. The reconciliation definition, IF it exists (empty result = it does not).
--    Three screens, the KPI export and the PO-team "Required" column all assume
--    it joins on (item_code, lot, location) and derives
--    expected_max = ceil(required/moq)*moq.
select c.relname, pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v', 'm') and c.relname ilike '%reconcil%';

-- 2. Row-level security policies.
--    Confirms whether po_team can UPDATE po_line (the PO-team quantity editor)
--    and whether uploader can write item_master (auto-registration on upload).
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3. The scheduled jobs (9-working-hour auto-escalation).
--    If this already sends mail via pg_net the MD would get two notifications.
--    to_regclass avoids an error when pg_cron is not installed.
select case
         when to_regclass('cron.job') is null then 'pg_cron NOT installed'
         else 'pg_cron installed — see next result'
       end as cron_status;

-- 3b. Only meaningful if the line above says installed; harmless otherwise.
select jobid, schedule, jobname, active, command
from cron.job
order by jobid;

-- 4. Which MOQ the data actually carries.
--    MOQ is not in your item master, so a non-zero moq can only come from
--    po_line (set per supplier when the PO is drafted).
select
  (select count(*) from public.item_master where coalesce(moq, 0) > 0) as item_master_with_moq,
  (select count(*) from public.po_line     where coalesce(moq, 0) > 0) as po_line_with_moq;

-- 5. Has the current sheet been re-parsed under the fixed rules?
--    negative_lines should be 0 and null_item_code low after a re-parse.
select
  s.style_ref,
  s.status,
  count(r.id)                                      as lines,
  count(*) filter (where r.required_qty < 0)       as negative_lines,
  count(*) filter (where r.item_code is null)      as null_item_code,
  count(*) filter (where r.assigned_buyer is null) as unassigned
from public.rm_sheet s
left join public.rm_requirement r on r.rm_sheet_id = s.id
group by s.id, s.style_ref, s.status
order by max(s.created_at) desc;
