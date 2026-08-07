-- Assign buyers in one round trip instead of forty.
--
-- Saving assignments took over a minute. Not because anything was slow to
-- compute — the join it depends on runs in 4ms — but because the work was
-- spread across roughly forty separate HTTP requests: three to page in every
-- requirement line, one per hundred lines to write the buyer back, three more
-- to page them in again to decide the sheet's status, then the status and the
-- audit row. Each of those crosses from the web host to the database region and
-- back, and that distance is paid forty times over whatever the query costs.
--
-- Expressed as one statement, the whole assignment is a single round trip.
--
-- SECURITY INVOKER deliberately: this runs as the person who called it, so the
-- purchase-head policy on rm_requirement still decides what may be written.
-- A SECURITY DEFINER version would be faster to write and would quietly hand
-- every signed-in user the ability to reassign anyone's work.

create or replace function public.assign_buyers(
  p_sheet_id    uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated      bigint;
  v_matched      bigint;
  v_unassigned   bigint;
  v_all_assigned boolean;
begin
  if p_sheet_id is null then
    raise exception 'assign_buyers: no sheet given';
  end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' then
    raise exception 'assign_buyers: assignments must be a JSON array';
  end if;

  with a as (
    -- WITH ORDINALITY keeps the caller's order, which carries meaning: the
    -- client sends category-wide routing and then per-item exceptions, and the
    -- later entry is the one that must win.
    select
      ord,
      nullif(e ->> 'category', '')                  as category,
      nullif(upper(btrim(e ->> 'itemCode')), '')    as item_code,
      nullif(e ->> 'buyerId', '')::uuid             as buyer_id
    from jsonb_array_elements(p_assignments) with ordinality as t(e, ord)
  ),
  lines as (
    -- The same rule the screen groups by: a line with no item code, or one
    -- whose code is not in the item master, belongs to '__unmatched__'.
    select
      r.id,
      nullif(upper(btrim(r.item_code)), '') as item_code,
      case
        when r.item_code is null then '__unmatched__'
        else coalesce(m.category, '__unmatched__')
      end as category
    from public.rm_requirement r
    left join public.item_master m on m.item_code = r.item_code
    where r.rm_sheet_id = p_sheet_id
  ),
  chosen as (
    -- DISTINCT ON with ord descending picks the last assignment that matches
    -- each line — the same result the sequential loop reached by overwriting.
    select distinct on (l.id) l.id, a.buyer_id
    from lines l
    join a
      on (a.item_code is not null and a.item_code = l.item_code)
      or (a.item_code is null and a.category is not null and a.category = l.category)
    order by l.id, a.ord desc
  )
  update public.rm_requirement r
     set assigned_buyer = c.buyer_id
    from chosen c
   where r.id = c.id
     -- Rows already holding the right buyer are left alone. Re-saving an
     -- unchanged screen then writes nothing at all.
     and r.assigned_buyer is distinct from c.buyer_id;
  get diagnostics v_updated = row_count;

  -- Sheet status, from the rows as they now stand.
  select count(*), count(*) filter (where assigned_buyer is null)
    into v_matched, v_unassigned
  from public.rm_requirement
  where rm_sheet_id = p_sheet_id
    and item_code is not null;

  v_all_assigned := v_matched > 0 and v_unassigned = 0;

  update public.rm_sheet
     set status = case when v_all_assigned then 'assigned' else 'uploaded' end
   where id = p_sheet_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, detail)
  values (
    auth.uid(), 'rm_sheet', p_sheet_id, 'assigned',
    jsonb_build_object(
      'lines_updated', v_updated,
      'all_assigned',  v_all_assigned
    )
  );

  return jsonb_build_object(
    'updated',        v_updated,
    'matched_lines',  v_matched,
    'unassigned',     v_unassigned,
    'all_assigned',   v_all_assigned
  );
end $$;

comment on function public.assign_buyers(uuid, jsonb) is
  'Apply a sheet''s buyer assignments, set its status and record the change, in
   one statement. SECURITY INVOKER — the caller''s RLS policies still apply.';

revoke all on function public.assign_buyers(uuid, jsonb) from public;
grant execute on function public.assign_buyers(uuid, jsonb) to authenticated;


-- Buyer totals for the assignment email, without reading every line.
--
-- The notification counted lines per buyer by paging in every assigned row and
-- tallying them in Python — three requests and a few thousand rows to produce
-- one small number per buyer.
create or replace function public.assigned_buyer_counts(p_sheet_id uuid)
returns table (buyer_id uuid, lines bigint)
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select assigned_buyer, count(*)
  from public.rm_requirement
  where rm_sheet_id = p_sheet_id
    and assigned_buyer is not null
  group by assigned_buyer;
$$;

comment on function public.assigned_buyer_counts(uuid) is
  'Lines assigned per buyer on a sheet, for the assignment notification.';

revoke all on function public.assigned_buyer_counts(uuid) from public;
grant execute on function public.assigned_buyer_counts(uuid) to authenticated;


-- The assignment update filters on (rm_sheet_id, item_code); the status check
-- that follows filters on (rm_sheet_id, assigned_buyer). Both are covered here,
-- so neither has to scan the sheet's lines.
create index if not exists rm_requirement_sheet_item_idx
  on public.rm_requirement (rm_sheet_id, item_code);

create index if not exists rm_requirement_sheet_buyer_idx
  on public.rm_requirement (rm_sheet_id, assigned_buyer);

-- Verify:
--   select public.assign_buyers(
--     (select id from public.rm_sheet order by created_at desc limit 1),
--     '[]'::jsonb);
