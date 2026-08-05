-- Run this in the Supabase SQL Editor and paste the single cell it returns.
-- READ-ONLY.
--
-- Written as ONE statement returning ONE json column, because the editor shows
-- only the last result set of a multi-statement file and aborts the whole batch
-- at the first error. Nothing here can error: every object is reached through
-- the system catalogue, so a missing one yields null instead of 42P01.
--
-- Already established by earlier runs:
--   * cron.job does not exist -> pg_cron is NOT installed, so the 9-working-
--     hour auto-escalation never fires. Dropped from this file; the sweep in
--     notifyMdEscalations() is what actually escalates.
--   * public.reconciliation did not resolve -> re-checked by "recon_like"
--     below, which searches every schema rather than just public.

select jsonb_pretty(jsonb_build_object(

  -- Does a reconciliation relation exist under ANY schema, and of what kind?
  -- An empty array means the app's six call sites read a relation that is not
  -- there, and 20260805_reconciliation_view.sql should be applied.
  'recon_like', coalesce((
    select jsonb_agg(jsonb_build_object(
             'schema', n.nspname, 'name', c.relname,
             'kind', case c.relkind when 'v' then 'view'
                                    when 'm' then 'materialized view'
                                    when 'r' then 'table'
                                    else c.relkind::text end,
             'definition', case when c.relkind in ('v','m')
                                then pg_get_viewdef(c.oid, true) end))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname ilike '%reconcil%'), '[]'::jsonb),

  -- Everything that DOES exist in public, so the real schema is on record.
  'public_objects', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.relname,
             'kind', case c.relkind when 'v' then 'view'
                                    when 'm' then 'materialized view'
                                    when 'r' then 'table'
                                    else c.relkind::text end)
             order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m')), '[]'::jsonb),

  -- RLS policies. Confirms whether po_team can UPDATE po_line (the PO-team
  -- quantity editor) and whether uploader can write item_master.
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
             'table', tablename, 'policy', policyname, 'cmd', cmd,
             'using', qual, 'check', with_check)
             order by tablename, policyname)
    from pg_policies where schemaname = 'public'), '[]'::jsonb),

  -- Which tables have RLS switched on at all. A table carrying policies but
  -- with relrowsecurity = false is wide open regardless of those policies.
  'rls_enabled', coalesce((
    select jsonb_object_agg(c.relname, c.relrowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'), '{}'::jsonb),

  -- Installed extensions (confirms pg_cron / pg_net absence).
  'extensions', coalesce((
    select jsonb_agg(extname order by extname) from pg_extension), '[]'::jsonb),

  -- Functions the app calls by name. add_working_hours is required to raise an
  -- escalation at all (escalate_after is NOT NULL and comes from it), and
  -- has_role backs every RLS policy. A missing name here breaks that feature.
  'functions', coalesce((
    select jsonb_agg(p.proname order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('add_working_hours','has_role','is_staff','my_role',
                        'buyer_on_sheet','can_see_po')), '[]'::jsonb),

  -- Where MOQ actually lives. MOQ is not in your item master, so a non-zero
  -- value can only come from po_line, set per supplier when the PO is drafted.
  'moq', jsonb_build_object(
    'item_master_with_moq', (select count(*) from public.item_master where coalesce(moq,0) > 0),
    'po_line_with_moq',     (select count(*) from public.po_line     where coalesce(moq,0) > 0)),

  -- Has the sheet been re-parsed under the fixed rules? negative_lines should
  -- be 0 and null_item_code low afterwards.
  'sheets', coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
               'style_ref', s.style_ref, 'status', s.status,
               'created_at', s.created_at,
               'lines', count(r.id),
               'negative_lines', count(*) filter (where r.required_qty < 0),
               'null_item_code', count(*) filter (where r.item_code is null),
               'unassigned',     count(*) filter (where r.assigned_buyer is null)) as x
      from public.rm_sheet s
      left join public.rm_requirement r on r.rm_sheet_id = s.id
      group by s.id, s.style_ref, s.status, s.created_at) t), '[]'::jsonb),

  -- Do any PO lines exist yet? Reconciliation compares against these, so if
  -- this is 0 then every line reads not_bought no matter what the view does.
  'po_volume', jsonb_build_object(
    'pos',      (select count(*) from public.po),
    'po_lines', (select count(*) from public.po_line),
    'lines_with_null_item_code', (select count(*) from public.po_line where item_code is null))

)) as inspect;
