-- Empty the database, keeping only the logins.
--
-- ⚠️  IRREVERSIBLE. No undo, no backup taken by this script. Run it in the
--     Supabase SQL Editor, which connects as the table owner and is not
--     subject to RLS — so it deletes regardless of the admin-only policies the
--     application enforces.
--
-- WHAT THIS DELETES — everything except the accounts:
--   rm_sheet, rm_requirement   uploaded sheets and their lines
--   po, po_line                every purchase order, draft or sent
--   approval, escalation       approvals and escalations
--   grn, grn_mail              goods received, and the mail-fetch history
--   audit_log                  the activity trail
--   uom_conversion             unit conversions
--   item_master                THE ITEM MASTER — around 12,000 rows. Uploading
--                              a sheet afterwards will match nothing until it
--                              is imported again from Admin → Item Master.
--
-- WHAT THIS KEEPS:
--   profiles + auth.users      every login and its role. Deleting these locks
--                              you out of the application with no way back in
--                              from the app itself.
--
-- A table that does not exist yet is skipped rather than fatal, so this works
-- whatever subset of migrations has been applied. Deletion order is
-- children-before-parents; the whole thing runs as one statement, so a failure
-- leaves the database as it was rather than half-emptied.

do $$
declare
  -- Order matters. item_master is last of all: rm_requirement, po_line and
  -- uom_conversion all reference it, so it cannot go until they have.
  -- audit_log sits just before, since everything above is recorded in it.
  targets text[] := array[
    'grn_mail', 'grn',
    'approval', 'escalation',
    'po_line', 'po',
    'rm_requirement', 'rm_sheet',
    'audit_log',
    'uom_conversion', 'item_master'
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


-- Confirm. Counted the same way, so a table added by a later migration is
-- reported rather than breaking the query.
create temp table if not exists _reset_counts (t text, n bigint) on commit drop;
truncate _reset_counts;

do $$
declare
  t text;
begin
  foreach t in array array[
    'rm_sheet', 'rm_requirement', 'po', 'po_line', 'approval', 'escalation',
    'grn', 'grn_mail', 'audit_log', 'item_master', 'uom_conversion', 'profiles'
  ] loop
    if to_regclass('public.' || t) is null then
      insert into _reset_counts values (t || '  (not created yet)', null);
    else
      execute format('insert into _reset_counts select %L, count(*) from public.%I', t, t);
    end if;
  end loop;
end $$;

select t as table_name,
       n as rows,
       case
         when n is null then 'n/a'
         when t = 'profiles' then 'kept — your logins'
         when n = 0 then 'cleared'
         else 'STILL HAS ROWS'
       end as result
from _reset_counts
order by t;


-- ─────────────────────────────────────────────────────────────────────────
-- If you wanted to KEEP the item master, you needed this instead — it is
-- ~12,000 rows and slow to re-import, and nothing about it is test data:
--
--   remove 'uom_conversion', 'item_master' from the targets array above.
-- ─────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────
-- OPTIONAL — only if you also want every login except the admins removed.
--
-- Run AFTER the deletes above: rm_sheet.uploaded_by, po.created_by,
-- rm_requirement.assigned_buyer and audit_log.actor_id all reference these
-- accounts, and none of it can go while those rows still exist.
--
-- The guard is not decoration. Deleting every account locks you out of the
-- application with no way back in from the app, which is not something to
-- discover at the login screen.
--
--   do $$
--   begin
--     if (select count(*) from public.profiles where role = 'admin') = 0 then
--       raise exception 'No admin account exists — refusing to delete logins.';
--     end if;
--
--     delete from public.profiles  where role <> 'admin';
--     delete from auth.users u
--      where not exists (select 1 from public.profiles p where p.id = u.id);
--   end $$;
-- ─────────────────────────────────────────────────────────────────────────


-- NOTE: uploaded FILES are not touched by any of this. The sheets and PO
-- documents live in Storage, not in the database. To clear those too, empty
-- the `rm-sheets` and `po-docs` buckets from Storage in the dashboard.
