-- Channel (sales channel / POC) from the RM sheet, alongside department.
--
-- The parser already recognised a "Channel"/"POC" column (see
-- api/app/parsing.py ALIASES) but had nowhere to put it — it was dropped on
-- the floor after raw_row. Buyers need it visible next to the requirement
-- line, same as department, so it gets its own column rather than living
-- only inside raw_row JSON.

alter table public.rm_requirement
  add column if not exists channel text;

comment on column public.rm_requirement.channel is
  'Sales channel / POC from the source RM sheet column ("Channel"/"POC"),
   parsed the same way as department. Visible to buyers and anyone else who
   can already read this row -- not access-restricted beyond that.';

-- Re-create replace_rm_requirements to carry channel through the
-- delete-and-insert, same as department.
create or replace function public.replace_rm_requirements(
  p_sheet_id uuid,
  p_rows     jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  if p_sheet_id is null then
    raise exception 'replace_rm_requirements: no sheet given';
  end if;

  delete from public.rm_requirement where rm_sheet_id = p_sheet_id;

  insert into public.rm_requirement (
    rm_sheet_id, item_code, raw_code, raw_label, raw_unit, required_qty,
    lot, location, department, channel, color, match_confidence,
    needs_review, raw_row
  )
  select
    p_sheet_id,
    r->>'item_code',
    r->>'raw_code',
    r->>'raw_label',
    r->>'raw_unit',
    coalesce((nullif(r->>'required_qty', ''))::numeric, 0),
    r->>'lot',
    r->>'location',
    r->>'department',
    r->>'channel',
    r->>'color',
    (nullif(r->>'match_confidence', ''))::numeric,
    coalesce((nullif(r->>'needs_review', ''))::boolean, false),
    r->'raw_row'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

comment on function public.replace_rm_requirements(uuid, jsonb) is
  'Delete a sheet''s requirement lines and insert the given rows, in one
   transaction, so a failed re-parse cannot leave the sheet with none.
   Carries channel through alongside department (2026-08-28).';
