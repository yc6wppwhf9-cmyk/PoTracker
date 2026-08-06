-- Confirms the migrations applied so far. READ-ONLY, one row per check.
-- Everything should read PASS. Run in the Supabase SQL Editor.

with checks as (
  select 'po.etd + po.site (20260808)' as check_name,
         (select count(*) = 2 from information_schema.columns
           where table_schema='public' and table_name='po'
             and column_name in ('etd','site')) as ok
  union all
  select 'po.po_number (20260809)',
         (select count(*) = 1 from information_schema.columns
           where table_schema='public' and table_name='po' and column_name='po_number')
  union all
  select 'po_number is unique (20260809)',
         to_regclass('public.po_po_number_key') is not null
  union all
  select 'grn table (20260810)',
         to_regclass('public.grn') is not null
  union all
  select 'grn RLS enabled (20260810)',
         coalesce((select c.relrowsecurity from pg_class c
                    join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname='grn'), false)
  union all
  select 'po_team can edit po_line (20260805)',
         exists (select 1 from pg_policies
                  where schemaname='public' and tablename='po_line'
                    and cmd='UPDATE' and policyname='po_line_update_po_team')
  union all
  select 'uploader can add items (20260806)',
         exists (select 1 from pg_policies
                  where schemaname='public' and tablename='item_master'
                    and cmd='INSERT' and policyname='item_master_insert_uploader')
  union all
  select 'sheet delete is admin-only (20260807)',
         exists (select 1 from pg_policies
                  where schemaname='public' and tablename='rm_sheet'
                    and cmd='DELETE' and policyname='rm_sheet_delete_admin')
  union all
  select 'po.status allows sent (20260812)',
         exists (select 1 from pg_constraint
                  where conrelid = 'public.po'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) like '%sent%')
  union all
  select 'grn_mail table (20260811)',
         to_regclass('public.grn_mail') is not null
  union all
  select 'po approval columns (20260813)',
         (select count(*) = 4 from information_schema.columns
           where table_schema='public' and table_name='po'
             and column_name in ('approval_status','approved_by','approved_at','approval_note'))
  union all
  select 'escalation.po_id (20260813)',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='escalation'
                    and column_name='po_id')
  union all
  select 'approver can update po (20260813)',
         exists (select 1 from pg_policies
                  where schemaname='public' and tablename='po'
                    and cmd='UPDATE' and policyname='po_update_approver')
  union all
  select 'emails_for_role() (20260814)',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='emails_for_role')
  union all
  -- The blanket policies these replaced must be gone, not merely joined by a
  -- narrower one: policies are OR'ed, so one `using (true)` still lets anyone
  -- delete everything.
  select 'blanket delete policies removed (20260806/07)',
         not exists (select 1 from pg_policies
                      where schemaname='public' and cmd='DELETE'
                        and policyname like 'Allow delete on %')
)
select case when ok then 'PASS' else 'FAIL' end as result, check_name
from checks
order by ok, check_name;
