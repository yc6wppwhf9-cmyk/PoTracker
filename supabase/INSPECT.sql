-- Round 2. Run in the Supabase SQL Editor and paste the single cell.
-- READ-ONLY. One statement, one json column, nothing that can raise 42P01.
--
-- Round 1 settled most of it:
--   * public.reconciliation EXISTS and joins on (item_code, lot, location)
--     with expected_max = ceil(required/moq)*moq, as the app assumed. Its MOQ
--     is coalesce(po_line.moq, item_master.moq, 0) and its tolerance is
--     greatest(required * 0.015, 2).
--   * pg_cron IS installed; add_working_hours and has_role all exist.
--   * item_master is admin-write only, so uploader auto-registration has
--     always been refused  -> 20260806_uploader_can_auto_register_items.sql
--   * po_team cannot UPDATE po_line -> 20260805_po_team_can_edit_po_lines.sql
--   * five tables carry DELETE using(true) -> 20260806_restrict_blanket_...sql
--
-- Two things the catalogue dump could not answer, plus a data question.

select jsonb_pretty(jsonb_build_object(

  -- 1. SECURITY: does the reconciliation view run as caller or as owner?
  --    A Postgres view defaults to the OWNER's rights, which bypasses RLS on
  --    rm_requirement / po_line / item_master. If security_invoker is not set,
  --    any signed-in user reading `reconciliation` sees every sheet in the
  --    company, regardless of the row policies. Expected: security_invoker=on.
  'view_security', coalesce((
    select jsonb_build_object(
             'owner', pg_get_userbyid(c.relowner),
             'reloptions', coalesce(to_jsonb(c.reloptions), 'null'::jsonb),
             'security_invoker',
               coalesce(array_to_string(c.reloptions, ',') ilike '%security_invoker=on%', false))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'reconciliation'), '{}'::jsonb),

  -- 2. Is an escalation job actually SCHEDULED? pg_cron is installed, but the
  --    extension being present does not mean a job exists. Reached through the
  --    catalogue so a missing cron schema yields null rather than an error.
  'cron_jobs', coalesce((
    select jsonb_agg(to_jsonb(j) - 'nodename' - 'nodeport' - 'database')
    from cron.job j
    where to_regclass('cron.job') is not null), '[]'::jsonb),

  -- 3. The database is empty of sheets and POs. Is the reference data still
  --    there? If item_master has rows this is your project with the sheets
  --    deleted; if it is 0 too, this is a rebuilt or different project.
  'row_counts', jsonb_build_object(
    'item_master',    (select count(*) from public.item_master),
    'uom_conversion', (select count(*) from public.uom_conversion),
    'profiles',       (select count(*) from public.profiles),
    'rm_sheet',       (select count(*) from public.rm_sheet),
    'escalation',     (select count(*) from public.escalation),
    'audit_log',      (select count(*) from public.audit_log)),

  -- 4. If a sheet was deleted, the audit trail says who and when.
  'recent_audit', coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', a.created_at, 'action', a.action, 'entity', a.entity)
             order by a.created_at desc)
    from (select * from public.audit_log order by created_at desc limit 15) a
  ), '[]'::jsonb)

)) as inspect;
