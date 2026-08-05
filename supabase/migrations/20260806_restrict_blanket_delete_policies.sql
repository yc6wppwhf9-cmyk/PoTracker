-- SUPERSEDED by 20260807_admin_only_sheet_deletion.sql, which narrows the
-- purchase_head grants below to admin. Apply that file after this one — or
-- instead of it, since it drops these policy names by name first. Kept for the
-- record of what the original state was.
--
-- SECURITY: five tables allow any signed-in user to delete any row.
--
--   "Allow delete on approval"        DELETE using true
--   "Allow delete on po"              DELETE using true
--   "Allow delete on po_line"         DELETE using true
--   "Allow delete on rm_requirement"  DELETE using true
--   "Allow delete on rm_sheet"        DELETE using true
--
-- `using (true)` means the check passes for every authenticated role. Any
-- account — an uploader, a buyer, a compromised login — can erase every sheet,
-- every PO and every approval in the database. Nothing in the app depends on
-- that breadth; the names suggest they were added to unblock a delete that was
-- failing, and never narrowed afterwards.
--
-- Each is replaced below by the narrowest policy that keeps the real callers
-- working. Verified against every delete in the codebase:
--
--   deleteSheetAction        web/src/app/procurement/assign/actions.ts:135
--                            requireRole("purchase_head"); cascades through
--                            approval, escalation, po_line, po, rm_requirement,
--                            rm_sheet — so purchase_head needs all six.
--   re-parse                 api/app/routers/rm_sheets.py:96
--                            deletes rm_requirement for a sheet the uploader
--                            owns; already covered by rm_req_delete_owner.
--   PO rollback              api/app/routers/rm_sheets.py:350, pos.py:357
--                            deletes a po the buyer just created, after a
--                            failed attach — so the creator needs delete on po.
--
-- audit_log is deliberately absent: it has no delete policy and must not get
-- one, or the trail could be edited by whoever it incriminates.

-- rm_sheet: only the purchase head prunes sheets.
drop policy if exists "Allow delete on rm_sheet" on public.rm_sheet;
create policy rm_sheet_delete_head
  on public.rm_sheet for delete
  using (public.has_role(variadic array['purchase_head', 'admin']::public.app_role[]));

-- rm_requirement: the sheet owner re-parses (rm_req_delete_owner already
-- covers that), and the purchase head deletes the sheet.
drop policy if exists "Allow delete on rm_requirement" on public.rm_requirement;
create policy rm_requirement_delete_head
  on public.rm_requirement for delete
  using (public.has_role(variadic array['purchase_head', 'admin']::public.app_role[]));

-- po: the buyer who created it (rollback after a failed attach), or the
-- purchase head deleting the whole sheet.
drop policy if exists "Allow delete on po" on public.po;
create policy po_delete_creator_or_head
  on public.po for delete
  using (
    created_by = auth.uid()
    or public.has_role(variadic array['purchase_head', 'admin']::public.app_role[])
  );

-- po_line: follows its parent PO, reusing the same visibility rule the select
-- policy uses, plus the purchase head.
drop policy if exists "Allow delete on po_line" on public.po_line;
create policy po_line_delete_via_po
  on public.po_line for delete
  using (
    exists (
      select 1 from public.po x
      where x.id = po_line.po_id and x.created_by = auth.uid()
    )
    or public.has_role(variadic array['purchase_head', 'admin']::public.app_role[])
  );

-- approval: only roles that can create or act on one.
drop policy if exists "Allow delete on approval" on public.approval;
create policy approval_delete_staff
  on public.approval for delete
  using (public.has_role(variadic array['purchase_head', 'approver', 'admin']::public.app_role[]));

-- escalation had no delete policy at all, yet deleteSheetAction deletes from
-- it. That delete has been silently affecting zero rows, orphaning escalations
-- whose sheet is gone.
drop policy if exists escalation_delete_head on public.escalation;
create policy escalation_delete_head
  on public.escalation for delete
  using (public.has_role(variadic array['purchase_head', 'admin']::public.app_role[]));
