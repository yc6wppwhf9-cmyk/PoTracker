-- RM stock gallery: a photo and an on-hand quantity for every raw material.
--
-- The item master already carries what a material IS (code, name, category,
-- unit, MOQ). This adds what a material LOOKS LIKE and HOW MUCH is on hand, so
-- the whole catalogue can be browsed as a picture gallery rather than a table
-- of codes.
--
--   photo_path        object key inside the `rm-photos` storage bucket, or
--                     NULL when no picture has been uploaded yet.
--   stock_qty         on-hand quantity, maintained by hand. There is no
--                     issuance/consumption ledger in this system, so stock
--                     cannot be derived; it is a number staff keep current.
--   stock_updated_at  when stock_qty was last set, so a stale figure is
--                     visible as stale rather than trusted blindly.

alter table public.item_master
  add column if not exists photo_path       text,
  add column if not exists stock_qty        numeric not null default 0,
  add column if not exists stock_updated_at timestamptz;

comment on column public.item_master.photo_path is
  'Object key inside the rm-photos storage bucket; NULL if no photo uploaded.';
comment on column public.item_master.stock_qty is
  'On-hand quantity, maintained manually. No consumption ledger exists to derive it.';
comment on column public.item_master.stock_updated_at is
  'When stock_qty was last set, so a stale figure reads as stale.';

-- The gallery orders and filters by name; a large catalogue (~12k rows) makes
-- the scan worth an index.
create index if not exists item_master_name_idx
  on public.item_master (name);

-- Existing item_master policies already cover the new columns:
--   item_master_read         SELECT using true          — everyone can browse
--   item_master_admin_write  ALL    using has_role(admin) — only admins edit
-- so no table policy changes are needed for stock_qty / photo_path.

-- ── Storage bucket for the photos ──────────────────────────────────────────
-- Public-read: raw-material photos are not sensitive, and a public bucket lets
-- the gallery render <img> tags with a plain URL instead of minting a signed
-- URL per image on every page load (a page shows dozens at once).
insert into storage.buckets (id, name, public)
values ('rm-photos', 'rm-photos', true)
on conflict (id) do update set public = true;

-- Writes are admin-only, matching item_master_admin_write. Reads are public
-- (the bucket's `public` flag), so no SELECT policy is needed here.
drop policy if exists rm_photos_admin_insert on storage.objects;
create policy rm_photos_admin_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'rm-photos' and public.has_role(variadic array['admin']::public.app_role[]));

drop policy if exists rm_photos_admin_update on storage.objects;
create policy rm_photos_admin_update
  on storage.objects for update to authenticated
  using (bucket_id = 'rm-photos' and public.has_role(variadic array['admin']::public.app_role[]))
  with check (bucket_id = 'rm-photos' and public.has_role(variadic array['admin']::public.app_role[]));

drop policy if exists rm_photos_admin_delete on storage.objects;
create policy rm_photos_admin_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'rm-photos' and public.has_role(variadic array['admin']::public.app_role[]));
