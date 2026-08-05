-- Auto-registration of new item codes on upload has never worked.
--
-- item_master carries exactly two policies:
--   item_master_read         SELECT  using true
--   item_master_admin_write  ALL     using has_role(admin)
--
-- so the upsert in api/app/routers/rm_sheets.py (~line 225) is refused for
-- every uploader. The code catches the failure and turns it into a warning,
-- which is why the upload still succeeded — but every code absent from the
-- catalogue then fell through to needs_review with a NULL item_code. That is
-- the origin of the large unmatched-line count on the last sheet.
--
-- A NULL item_code also drops the line out of the reconciliation view, which
-- filters `where item_code is not null` on both sides of its FULL JOIN. So an
-- unregistered material is invisible to reconciliation entirely: not
-- not_bought, simply absent.
--
-- The entries created here are provisional (moq 0, category from the sheet's
-- department) and the lines that created them are still flagged for review, so
-- this grants no ability to silently redefine an existing item: INSERT only,
-- never UPDATE or DELETE, which stay admin-only.

drop policy if exists item_master_insert_uploader on public.item_master;

create policy item_master_insert_uploader
  on public.item_master
  for insert
  with check (public.has_role(array['uploader', 'purchase_head', 'admin']::public.app_role[]));

-- NOTE on the upsert: `on_conflict=item_code` needs UPDATE as well whenever a
-- row already exists. It does not here, because rm_sheets.py only sends codes
-- missing from the catalogue it just read. Should that ever change, the upsert
-- would fail rather than overwrite a curated item — the safer failure.
