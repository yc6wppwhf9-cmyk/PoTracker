-- Replace rows in one transaction instead of deleting and hoping.
--
-- Two places destroyed data before writing its replacement, with no
-- transaction around the pair:
--
--   * The GRN import deleted every row for the GRC numbers in the file, then
--     inserted the new ones in chunks of a thousand. A failure between the two
--     — a bad value, a dropped connection, the instance being recycled mid
--     request — left those receipts gone and the replacement partly written.
--     Nothing reported it: the register still looked imported, and quantities
--     the approver judges deliveries against were simply lower than reality.
--
--   * Re-parsing an RM sheet deleted its requirement lines and rebuilt them.
--     If the parse or the insert failed, the sheet kept its identity, its
--     assignments and its POs, and lost the requirements they refer to.
--
-- A PostgREST call cannot span statements, so the delete and the insert were
-- always going to be two round trips. Inside a function they are one
-- statement to the caller and one transaction to Postgres: it either all
-- happens or none of it does.
--
-- SECURITY INVOKER on both. These run as the person who called them, so the
-- same RLS decides what may be written — the transaction is the only thing
-- being added.

-- ---------------------------------------------------------------------------
-- Receipts for a set of GRC numbers.
-- ---------------------------------------------------------------------------
create or replace function public.replace_grn_rows(
  p_grc_numbers text[],
  p_rows        jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  if p_grc_numbers is null or array_length(p_grc_numbers, 1) is null then
    return 0;
  end if;

  delete from public.grn where grc_no = any(p_grc_numbers);

  insert into public.grn (
    grc_no, grc_date, po_number, po_date, item_code, item_name, lot, qty,
    supplier, stock_point, department, doc_no, doc_date, landed_cost,
    remarks, imported_by
  )
  select
    r->>'grc_no',
    (nullif(r->>'grc_date', ''))::date,
    r->>'po_number',
    (nullif(r->>'po_date', ''))::date,
    r->>'item_code',
    r->>'item_name',
    r->>'lot',
    coalesce((nullif(r->>'qty', ''))::numeric, 0),
    r->>'supplier',
    r->>'stock_point',
    r->>'department',
    r->>'doc_no',
    (nullif(r->>'doc_date', ''))::date,
    (nullif(r->>'landed_cost', ''))::numeric,
    r->>'remarks',
    auth.uid()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

comment on function public.replace_grn_rows(text[], jsonb) is
  'Delete the receipts for these GRC numbers and insert the given rows, in one
   transaction. SECURITY INVOKER, so RLS still applies.';

revoke all on function public.replace_grn_rows(text[], jsonb) from public;
revoke execute on function public.replace_grn_rows(text[], jsonb) from anon;
grant execute on function public.replace_grn_rows(text[], jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- Requirement lines for one sheet.
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
    lot, location, department, color, match_confidence, needs_review, raw_row
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
   transaction, so a failed re-parse cannot leave the sheet with none.';

revoke all on function public.replace_rm_requirements(uuid, jsonb) from public;
revoke execute on function public.replace_rm_requirements(uuid, jsonb) from anon;
grant execute on function public.replace_rm_requirements(uuid, jsonb) to authenticated;

-- Verify — both must return 0 and change nothing:
--   select public.replace_grn_rows(array[]::text[], '[]'::jsonb);
--   select public.replace_rm_requirements(
--            (select id from public.rm_sheet limit 1), '[]'::jsonb);
--   ^ that second one DOES delete: pass a real sheet only if you mean it.
