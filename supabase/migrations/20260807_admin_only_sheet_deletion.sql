-- Deleting an RM sheet is now admin-only.
--
-- Supersedes the purchase_head grants in
-- 20260806_restrict_blanket_delete_policies.sql. Safe to run whether or not
-- that file was applied: every statement drops by name first, and the names
-- dropped cover both the original "Allow delete on ..." policies and the
-- narrowed ones from that migration.
--
-- Rationale: the cascade is irreversible and destroys purchasing history, so
-- it belongs with the smallest possible group. The application additionally
-- refuses the delete once any line has an assigned buyer — that rule lives in
-- deleteSheetAction, since it is a workflow condition rather than an identity
-- one, and RLS cannot express "no sibling row is assigned" without a subquery
-- on every delete.
--
-- Kept deliberately:
--   rm_req_delete_owner   the uploader deletes their own requirement rows when
--                         re-parsing a sheet (api/app/routers/rm_sheets.py:96).
--                         Re-parse is not deletion of a sheet.
--   po delete by creator  a buyer's PO is removed on a failed attach
--                         (rm_sheets.py:350, pos.py:357). Without this the
--                         rollback leaves an orphaned empty PO behind.

-- rm_sheet ------------------------------------------------------------------
drop policy if exists "Allow delete on rm_sheet" on public.rm_sheet;
drop policy if exists rm_sheet_delete_head       on public.rm_sheet;
create policy rm_sheet_delete_admin
  on public.rm_sheet for delete
  using (public.has_role(variadic array['admin']::public.app_role[]));

-- rm_requirement ------------------------------------------------------------
drop policy if exists "Allow delete on rm_requirement" on public.rm_requirement;
drop policy if exists rm_requirement_delete_head       on public.rm_requirement;
create policy rm_requirement_delete_admin
  on public.rm_requirement for delete
  using (public.has_role(variadic array['admin']::public.app_role[]));

-- po ------------------------------------------------------------------------
drop policy if exists "Allow delete on po"       on public.po;
drop policy if exists po_delete_creator_or_head  on public.po;
create policy po_delete_creator_or_admin
  on public.po for delete
  using (
    created_by = auth.uid()
    or public.has_role(variadic array['admin']::public.app_role[])
  );

-- po_line -------------------------------------------------------------------
drop policy if exists "Allow delete on po_line" on public.po_line;
drop policy if exists po_line_delete_via_po     on public.po_line;
create policy po_line_delete_via_po
  on public.po_line for delete
  using (
    exists (
      select 1 from public.po x
      where x.id = po_line.po_id and x.created_by = auth.uid()
    )
    or public.has_role(variadic array['admin']::public.app_role[])
  );

-- approval ------------------------------------------------------------------
drop policy if exists "Allow delete on approval" on public.approval;
drop policy if exists approval_delete_staff      on public.approval;
create policy approval_delete_admin
  on public.approval for delete
  using (public.has_role(variadic array['admin']::public.app_role[]));

-- escalation ----------------------------------------------------------------
drop policy if exists escalation_delete_head on public.escalation;
create policy escalation_delete_admin
  on public.escalation for delete
  using (public.has_role(variadic array['admin']::public.app_role[]));

-- Verify:
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and cmd = 'DELETE' order by tablename;
