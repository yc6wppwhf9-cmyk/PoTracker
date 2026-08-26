-- Total / SOH / Pending quantity breakdown from the RM sheet.
--
-- required_qty is whichever of "Pending" or "Total quantity" the sheet
-- offered (pending preferred, falling back to total) -- the single number the
-- buyer actually orders against. That collapses three source columns into
-- one, which loses the breakdown a buyer wants to see: how much is required
-- in total, how much stock is already on hand, and how much is still
-- pending. All three were already being read off the sheet (see
-- api/app/parsing.py ALIASES: total_qty, soh, pending_qty) but only fed into
-- required_qty -- never stored in their own right.

alter table public.rm_requirement
  add column if not exists total_qty   numeric,
  add column if not exists soh         numeric,
  add column if not exists pending_qty numeric;

comment on column public.rm_requirement.total_qty is
  'TOTAL_COMPONENT_QUANTITY (or equivalent alias) from the source sheet, kept
   independently of required_qty so the buyer sees the sheet''s own total,
   not just whichever figure was chosen to purchase against.';
comment on column public.rm_requirement.soh is
  'Stock-on-hand (SOH) from the source sheet at the time it was uploaded.';
comment on column public.rm_requirement.pending_qty is
  'PENDING_COMPONENT_TO_ISSUE (or equivalent alias) from the source sheet --
   usually the same figure as required_qty, since pending is preferred when
   both are present, but kept separately so total/SOH/pending can be shown
   side by side even on a sheet that only had a total column.';

-- ---------------------------------------------------------------------------
-- Backfill from raw_row for sheets already uploaded.
--
-- raw_row has always captured the original value of every column the parser
-- recognised, keyed by the sheet's own header text -- regardless of whether
-- that field had a dedicated column here. So the total/SOH/pending values for
-- existing rows are not lost; they just need pulling out of that JSON the
-- same way the parser itself matches a header to a field (see
-- parsing._detect_columns): normalise the key (lowercase, underscores to
-- spaces, whitespace collapsed), score an exact match higher than a
-- substring match, and take the best-scoring key.
--
-- pg_temp so this helper is gone the moment the migration's session ends --
-- it exists only to run the update below once.
-- ---------------------------------------------------------------------------
create or replace function pg_temp._alias_qty(raw_row jsonb, aliases text[])
returns numeric
language plpgsql
as $$
declare
  k          text;
  norm       text;
  a          text;
  score      int;
  best_score int := 0;
  best_text  text;
  cleaned    text;
begin
  if raw_row is null then
    return null;
  end if;

  for k in select jsonb_object_keys(raw_row) loop
    norm := trim(regexp_replace(lower(replace(k, '_', ' ')), '\s+', ' ', 'g'));
    if norm = '' then
      continue;
    end if;
    score := 0;
    foreach a in array aliases loop
      if norm = a then
        score := greatest(score, 100 + length(a));
      elsif position(a in norm) > 0 then
        score := greatest(score, length(a));
      end if;
    end loop;
    if score > best_score then
      best_score := score;
      best_text := raw_row ->> k;
    end if;
  end loop;

  if best_text is null then
    return null;
  end if;
  cleaned := replace(trim(best_text), ',', '');
  if cleaned = '' or cleaned = '-' then
    return null;
  end if;

  begin
    return cleaned::numeric;
  exception when others then
    return null;
  end;
end;
$$;

update public.rm_requirement
set
  total_qty = coalesce(
    total_qty,
    pg_temp._alias_qty(raw_row, array[
      'total component quantity', 'total qty', 'total quantity', 'required qty'
    ])
  ),
  soh = coalesce(
    soh,
    pg_temp._alias_qty(raw_row, array[
      'soh component quantity', 'soh', 'stock on hand', 'stock'
    ])
  ),
  pending_qty = coalesce(
    pending_qty,
    pg_temp._alias_qty(raw_row, array[
      'pending component to issue', 'pending to issue', 'final pending',
      'to purchase', 'pending'
    ])
  )
where raw_row is not null
  and (total_qty is null or soh is null or pending_qty is null);

-- ---------------------------------------------------------------------------
-- Re-create replace_rm_requirements to carry the three fields through the
-- delete-and-insert going forward, same as department/channel.
-- ---------------------------------------------------------------------------
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
    lot, location, department, channel, color, total_qty, soh, pending_qty,
    match_confidence, needs_review, raw_row
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
    (nullif(r->>'total_qty', ''))::numeric,
    (nullif(r->>'soh', ''))::numeric,
    (nullif(r->>'pending_qty', ''))::numeric,
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
   Carries channel, total_qty, soh and pending_qty through alongside
   department (2026-08-29).';
