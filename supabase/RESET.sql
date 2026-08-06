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
--   profiles + auth.users      your logins; deleting them locks you out
--
-- Order matters: children before parents, or foreign keys reject the delete.
-- Wrapped in a transaction, so a failure part-way leaves the database exactly
-- as it was rather than half-emptied.

begin;

delete from public.grn_mail;
delete from public.grn;

delete from public.approval;
delete from public.escalation;

delete from public.po_line;
delete from public.po;

delete from public.rm_requirement;
delete from public.rm_sheet;

-- Last: it references everything above, so anything earlier would have been
-- recorded here as it went.
delete from public.audit_log;

commit;

-- Confirm. Every count should be 0 except the two catalogues and profiles.
select 'rm_sheet' as t, count(*) from public.rm_sheet
union all select 'rm_requirement', count(*) from public.rm_requirement
union all select 'po',             count(*) from public.po
union all select 'po_line',        count(*) from public.po_line
union all select 'approval',       count(*) from public.approval
union all select 'escalation',     count(*) from public.escalation
union all select 'grn',            count(*) from public.grn
union all select 'grn_mail',       count(*) from public.grn_mail
union all select 'audit_log',      count(*) from public.audit_log
union all select 'item_master (kept)',    count(*) from public.item_master
union all select 'uom_conversion (kept)', count(*) from public.uom_conversion
union all select 'profiles (kept)',       count(*) from public.profiles
order by 1;


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


-- NOTE: uploaded FILES are not touched by any of this. The sheets and PO
-- documents live in Storage, not in the database. To clear those too, empty
-- the `rm-sheets` and `po-docs` buckets from Storage in the dashboard.
