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


-- Confirm.
--
-- A plain query rather than a temp table: creating one made the SQL Editor warn
-- that a table was being created without row-level security, which is a
-- meaningless question about a throwaway that is dropped at commit — and a
-- warning nobody should have to reason about beside a destructive script.
--
-- If a table has not been created yet this errors on that name; the deletes
-- above have already run and are unaffected, so delete the offending line and
-- run this part again.
select 'rm_sheet'       as table_name, count(*) as rows from public.rm_sheet
union all select 'rm_requirement', count(*) from public.rm_requirement
union all select 'po',             count(*) from public.po
union all select 'po_line',        count(*) from public.po_line
union all select 'approval',       count(*) from public.approval
union all select 'escalation',     count(*) from public.escalation
union all select 'grn',            count(*) from public.grn
union all select 'grn_mail',       count(*) from public.grn_mail
union all select 'audit_log',      count(*) from public.audit_log
union all select 'uom_conversion', count(*) from public.uom_conversion
union all select 'item_master',    count(*) from public.item_master
union all select 'profiles (kept)', count(*) from public.profiles
order by 1;


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
