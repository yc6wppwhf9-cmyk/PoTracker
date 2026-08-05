-- The PO team corrects ordered quantities to match the signed PO document
-- before attaching it (see /procurement/po-team/[sheetId]). That requires
-- UPDATE on po_line, which the original policy set may not grant — the buyer
-- creates the lines, so only INSERT was needed until now.
--
-- Safe to run whether or not the permission already exists: policies are OR'ed,
-- so an additional one can only widen access for these two roles, and the
-- DROP makes re-running this file idempotent.
--
-- Uses the existing has_role() helper rather than reading profiles directly,
-- matching the rest of the policy set.

drop policy if exists po_line_update_po_team on public.po_line;

create policy po_line_update_po_team
  on public.po_line
  for update
  using      (public.has_role(array['po_team', 'admin']::public.app_role[]))
  with check (public.has_role(array['po_team', 'admin']::public.app_role[]));

-- Verify afterwards with:
--   select policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'public' and tablename = 'po_line';
