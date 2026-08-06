-- Clear the transactional data and start fresh.
--
-- ⚠️  IRREVERSIBLE. There is no undo and no backup taken by this script.
--     Run it in the Supabase SQL Editor, which connects as the table owner and
--     is not subject to RLS — so it deletes regardless of the admin-only
--     policies the application enforces.
--
-- WHAT THIS DELETES
--   rm_sheet, rm_requirement   the uploaded sheets and their lines
--   po, po_line                every purchase order, draft or sent
--   approval, escalation       approvals and escalations raised against them
--   grn, grn_mail              goods received, and the mail-fetch history
--   audit_log                  the activity trail
--
-- WHAT THIS KEEPS
--   item_master                12,319 catalogue items — re-importing these is
--                              slow and they are not test data
--   uom_conversion             unit conversions, same reasoning
--   profiles + auth.users      every account, including the demo logins. Data
--                              referencing them is cleared below, so nothing
--                              needs the accounts removed as well.
--
-- A table that does not exist yet is skipped rather than fatal: the GRN tables
-- arrive with later migrations, and an earlier version of this script aborted
-- part-way through on a database where they had not been applied.
--
-- Order matters — children before parents, or foreign keys reject the delete —
-- and the whole thing runs as one statement, so a failure leaves the database
-- exactly as it was rather than half-emptied.

do $$
declare
  -- Deletion order. audit_log is last: it references everything above, so any
  -- earlier delete would have been recorded in it as it went.
  targets text[] := array[
    'grn_mail', 'grn',
    'approval', 'escalation',
    'po_line', 'po',
    'rm_requirement', 'rm_sheet',
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
         when t in ('item_master', 'uom_conversion', 'profiles') then 'kept'
         when n = 0 then 'cleared'
         else 'STILL HAS ROWS'
       end as result
from _reset_counts
order by t;


-- ─────────────────────────────────────────────────────────────────────────
-- OPTIONAL — only if you also want the catalogue gone.
--
-- rm_requirement.item_code and po_line.item_code both reference item_master,
-- so this must come after the deletes above. Re-importing 12,319 items takes
-- far longer than clearing them did, so this is deliberately not part of the
-- script proper.
--
--   begin;
--   delete from public.uom_conversion;
--   delete from public.item_master;
--   commit;
-- ─────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────
-- OPTIONAL — only if you want every login except the admins removed.
--
-- Run AFTER the deletes above: rm_sheet.uploaded_by, po.created_by,
-- rm_requirement.assigned_buyer and audit_log.actor_id all reference these
-- accounts, and none of it can go while those rows still exist.
--
-- The guard is not decoration. Deleting every account locks you out of the
-- application with no way back in from the app itself, so the block refuses to
-- run rather than leaving you to discover it at the login screen.
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
