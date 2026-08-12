-- Empty the working data, keeping the logins and the item master.
--
-- ⚠️  IRREVERSIBLE. No undo, no backup taken by this script. Run it in the
--     Supabase SQL Editor, which connects as the table owner and is not
--     subject to RLS — so it deletes regardless of the admin-only policies the
--     application enforces.
--
-- This is RESET.sql with the two reference tables left out. Use that one
-- instead if you want a genuinely blank database.
--
-- WHAT THIS DELETES:
--   rm_sheet, rm_requirement   uploaded sheets and their lines
--   po, po_line                every purchase order, draft or sent
--   approval, escalation       approvals and escalations
--   grn, grn_mail              goods received, and the mail-fetch history
--   audit_log                  the activity trail
--
-- WHAT THIS KEEPS:
--   profiles + auth.users      every login and its role
--   item_master                ~12,000 rows, slow to re-import, not test data
--   uom_conversion             part of the same reference set — keeping the
--                              item master but wiping the conversions would
--                              leave items that no longer convert. Add it to
--                              the array below if you really want it gone.
--
-- A table that does not exist yet is skipped rather than fatal. Deletion order
-- is children-before-parents, and the whole thing runs as one statement, so a
-- failure leaves the database as it was rather than half-emptied.

do $$
declare
  targets text[] := array[
    'grn_mail', 'grn',
    'approval', 'escalation',
    'po_line', 'po',
    'rm_requirement', 'rm_sheet',
    -- Last: everything above is recorded in it.
    'audit_log'
  ];
  t text;
  n bigint;
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipped %  (table does not exist)', t;
      continue;
    end if;
    execute format('delete from public.%I', t);
    get diagnostics n = row_count;
    raise notice 'cleared % rows from %', n, t;
  end loop;
end $$;


-- Confirm. The last three lines are the ones that should NOT be zero.
select 'rm_sheet'              as table_name, count(*) as rows from public.rm_sheet
union all select 'rm_requirement',       count(*) from public.rm_requirement
union all select 'po',                   count(*) from public.po
union all select 'po_line',              count(*) from public.po_line
union all select 'approval',             count(*) from public.approval
union all select 'escalation',           count(*) from public.escalation
union all select 'grn',                  count(*) from public.grn
union all select 'grn_mail',             count(*) from public.grn_mail
union all select 'audit_log',            count(*) from public.audit_log
union all select 'item_master  (kept)',  count(*) from public.item_master
union all select 'uom_conversion (kept)', count(*) from public.uom_conversion
union all select 'profiles (kept)',      count(*) from public.profiles
order by 1;


-- NOTE: uploaded FILES are not touched by any of this. Sheets and PO documents
-- live in Storage, not in the database, so after running this the tables are
-- empty but the files are still sitting in the buckets — orphaned, since the
-- rows that pointed at them are gone. Empty the `rm-sheets` and `po-docs`
-- buckets from Storage in the dashboard to finish the job.
