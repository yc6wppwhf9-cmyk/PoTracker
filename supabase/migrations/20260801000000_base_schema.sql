-- Captured base schema — the foundation every later migration builds on.
--
-- Until now this existed ONLY inside the hosted Supabase project
-- (ref zpuhlgjuoqrxcakeyhbg); the files in this directory were changes applied
-- on top of a base that lived nowhere in Git. A restore from the repository
-- alone would have produced an application with no tables and — the part that
-- matters — no row-level security policies. See supabase/README.md.
--
-- This file closes that gap. It was read out of the running database on
-- 2026-08-12 and reproduces the COMPLETE current state: the app_role enum, the
-- tables, indexes and constraints, the SECURITY DEFINER helper functions, the
-- reconciliation / grn_ours / po_delivery views, the triggers, every RLS
-- policy (the app's real access boundary), the function EXECUTE grants, the
-- Storage buckets and their policies, and the pg_cron auto-escalation job.
--
-- It is written to sort BEFORE the dated incremental migrations and to be fully
-- idempotent (create ... if not exists, create or replace, drop policy if
-- exists). Replaying it against a fresh database creates everything; the later
-- increments then re-run harmlessly on the finished schema. Replaying it
-- against the live database changes nothing. Either way the repository can now
-- recreate the database on its own.
--
-- Keep it that way: make schema changes as new migrations, not by hand in the
-- dashboard.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists "uuid-ossp";

-- pg_cron backs the auto-escalation job at the foot of this file. On Supabase
-- it is normally enabled from the dashboard; guarded so this migration still
-- applies where it is not installed (the job is simply skipped).
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not available (%). The auto_escalate_to_md job will be skipped.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Enum: the seven application roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'uploader', 'purchase_head', 'buyer', 'po_team', 'approver', 'md', 'admin'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id),
  email      text,
  full_name  text,
  role       public.app_role not null default 'uploader'::public.app_role,
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Application user profile + role. One row per auth.users id.';

create table if not exists public.item_master (
  item_code     text primary key,
  name          text not null,
  category      text not null,
  base_unit     text not null,
  moq           numeric not null default 0,
  created_at    timestamptz not null default now(),
  hsn_code      text,
  material_type text,
  article_name  text
);

create table if not exists public.uom_conversion (
  item_code      text not null references public.item_master (item_code),
  from_unit      text not null,
  factor_to_base numeric not null,
  primary key (item_code, from_unit)
);

create table if not exists public.rm_sheet (
  id           uuid primary key default gen_random_uuid(),
  style_ref    text,
  uploaded_by  uuid references auth.users (id),
  file_path    text,
  content_hash text,
  status       text not null default 'uploaded'
    check (status = any (array['uploaded','assigned','reconciled','approved','rejected'])),
  created_at   timestamptz not null default now()
);

create table if not exists public.rm_requirement (
  id               uuid primary key default gen_random_uuid(),
  rm_sheet_id      uuid not null references public.rm_sheet (id),
  item_code        text references public.item_master (item_code),
  required_qty     numeric not null,
  raw_label        text,
  raw_unit         text,
  needs_review     boolean not null default false,
  match_confidence numeric,
  assigned_buyer   uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  lot              text,
  department       text,
  color            text,
  location         text,
  raw_code         text,
  raw_row          jsonb
);
comment on column public.rm_requirement.raw_code is
  'COMPONENT ICODE exactly as written on the sheet; kept even when item_code is null (unmatched, needs_review).';

create table if not exists public.po (
  id              uuid primary key default gen_random_uuid(),
  rm_sheet_id     uuid not null references public.rm_sheet (id),
  created_by      uuid references auth.users (id),
  uploaded_by     uuid references auth.users (id),
  doc_path        text,
  status          text not null default 'draft'
    check (status = any (array['draft','sent','uploaded'])),
  created_at      timestamptz not null default now(),
  etd             date,
  site            text,
  po_number       text,
  approval_status text not null default 'pending'
    check (approval_status = any (array['pending','approved'])),
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  approval_note   text
);
comment on column public.po.etd is 'Estimated time of delivery for this purchase order, set by the buyer.';
comment on column public.po.site is 'Delivery site. Chosen from the fixed list in web/src/lib/sites.ts.';
comment on column public.po.po_number is 'Supplier-facing PO number from the attached document. Join key for GRN.';
comment on column public.po.approval_status is 'pending | approved. The approver is final; the MD only sees escalations.';

create table if not exists public.po_line (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references public.po (id),
  item_code   text references public.item_master (item_code),
  ordered_qty numeric not null,
  moq         numeric not null default 0,
  raw_label   text,
  raw_unit    text,
  created_at  timestamptz not null default now(),
  remark      text,
  lot         text,
  location    text,
  supplier    text,
  rate        numeric,
  etd         date,
  site        text
);
comment on column public.po_line.etd is 'Expected delivery date for this line. Falls back to po.etd when not set.';
comment on column public.po_line.site is 'Delivery site for this line. Falls back to po.site when not set.';

create table if not exists public.approval (
  id                uuid primary key default gen_random_uuid(),
  rm_sheet_id       uuid not null references public.rm_sheet (id),
  approver_id       uuid references auth.users (id),
  approver_decision text not null default 'pending'
    check (approver_decision = any (array['pending','approved'])),
  sent_to_md_at     timestamptz,
  md_id             uuid references auth.users (id),
  md_decision       text not null default 'pending'
    check (md_decision = any (array['pending','approved','rejected'])),
  md_summary        text,
  created_at        timestamptz not null default now()
);

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users (id),
  entity     text not null,
  entity_id  uuid,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.escalation (
  id                 uuid primary key default gen_random_uuid(),
  rm_sheet_id        uuid not null references public.rm_sheet (id),
  item_code          text references public.item_master (item_code),
  lot                text,
  raised_by          uuid references auth.users (id),
  assigned_buyer     uuid references auth.users (id),
  reason             text,
  status             text not null default 'open'
    check (status = any (array['open','resolved','md_escalated'])),
  escalate_after     timestamptz not null,
  escalated_to_md_at timestamptz,
  resolved_at        timestamptz,
  resolved_by        uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  location           text,
  po_id              uuid references public.po (id)
);
comment on column public.escalation.po_id is
  'The purchase order escalated, when raised from the PO approvals screen.';

create table if not exists public.grn (
  id          uuid primary key default gen_random_uuid(),
  grc_no      text not null,
  grc_date    date,
  po_number   text,
  po_date     date,
  item_code   text,
  lot         text,
  item_name   text,
  qty         numeric not null default 0,
  stock_point text,
  supplier    text,
  department  text,
  doc_no      text,
  doc_date    date,
  landed_cost numeric,
  remarks     text,
  raw         jsonb,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users (id)
);
comment on table public.grn is
  'Goods received register lines, imported from the GRC export. Quantities are per receipt; sum them per (po_number, item_code, lot) for the received total.';

create table if not exists public.grn_mail (
  id           uuid primary key default gen_random_uuid(),
  message_id   text not null,
  sender       text,
  subject      text,
  filename     text,
  status       text not null default 'imported',
  detail       text,
  lines        integer not null default 0,
  processed_at timestamptz not null default now(),
  processed_by uuid references auth.users (id),
  filter_key   text
);
comment on table public.grn_mail is
  'One row per GRN register email seen by the scheduled fetch. Unique on message_id, which is what stops a message being imported twice.';
comment on column public.grn_mail.filter_key is
  'Fingerprint of GRN_ALLOWED_SENDERS + GRN_SUBJECT_CONTAINS at the time the message was rejected. A message already rejected under the current settings is not fetched again; changing the settings changes the key and gives every rejected message a fresh hearing.';

-- ---------------------------------------------------------------------------
-- Indexes (PKs are created with the tables above)
-- ---------------------------------------------------------------------------
create index if not exists approval_sheet_idx on public.approval using btree (rm_sheet_id);
create index if not exists audit_log_entity_idx on public.audit_log using btree (entity, entity_id);
create index if not exists escalation_po_id_idx on public.escalation using btree (po_id) where (po_id is not null);
create index if not exists escalation_sheet_idx on public.escalation using btree (rm_sheet_id);
create index if not exists escalation_status_idx on public.escalation using btree (status);
create index if not exists grn_item_idx on public.grn using btree (item_code, lot);
create index if not exists grn_po_number_idx on public.grn using btree (po_number);
create unique index if not exists grn_receipt_line_key on public.grn using btree (grc_no, coalesce(item_code, ''::text), coalesce(lot, ''::text));
create index if not exists grn_mail_filter_key_idx on public.grn_mail using btree (filter_key) where (status = 'skipped'::text);
create unique index if not exists grn_mail_message_id_key on public.grn_mail using btree (message_id);
create index if not exists grn_mail_processed_at_idx on public.grn_mail using btree (processed_at desc);
create index if not exists po_approval_status_idx on public.po using btree (approval_status) where (approval_status = 'pending'::text);
create unique index if not exists po_po_number_key on public.po using btree (po_number) where (po_number is not null);
create index if not exists po_po_number_upper_idx on public.po using btree (upper(btrim(po_number))) where (po_number is not null);
create index if not exists po_sheet_idx on public.po using btree (rm_sheet_id);
create index if not exists po_line_po_id_idx on public.po_line using btree (po_id);
create index if not exists po_line_po_idx on public.po_line using btree (po_id);
create index if not exists rm_requirement_buyer_idx on public.rm_requirement using btree (assigned_buyer);
create index if not exists rm_requirement_sheet_buyer_idx on public.rm_requirement using btree (rm_sheet_id, assigned_buyer);
create index if not exists rm_requirement_sheet_idx on public.rm_requirement using btree (rm_sheet_id);
create index if not exists rm_requirement_sheet_item_idx on public.rm_requirement using btree (rm_sheet_id, item_code);

-- ---------------------------------------------------------------------------
-- Functions
--
-- The has_role / is_staff / my_role / can_see_po / buyer_on_sheet helpers are
-- SECURITY DEFINER so a policy can ask "what role is this caller?" without the
-- caller needing to read profiles directly. They are declared before the
-- policies that call them. has_role is VARIADIC — a policy must pass its roles
-- as separate arguments (has_role('a','b')), not a single array, or Postgres
-- raises 42883.
-- ---------------------------------------------------------------------------

create or replace function public.has_role(variadic roles public.app_role[])
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = any(roles)
  );
$function$;

create or replace function public.is_staff()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.has_role('purchase_head','po_team','approver','md','admin');
$function$;

create or replace function public.my_role()
 returns public.app_role
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select role from public.profiles where id = auth.uid();
$function$;

create or replace function public.buyer_on_sheet(sheet uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.rm_requirement r
    where r.rm_sheet_id = sheet and r.assigned_buyer = auth.uid()
  );
$function$;

create or replace function public.can_see_po(p uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.po x
    where x.id = p and (x.created_by = auth.uid() or public.is_staff())
  );
$function$;

create or replace function public.emails_for_role(p_role public.app_role)
 returns setof text
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select email
  from public.profiles
  where role = p_role
    and email is not null
    and email <> '';
$function$;

create or replace function public.buyers_for_assignment()
 returns table(id uuid, full_name text, email text)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.has_role(
       variadic array['uploader', 'purchase_head', 'admin']::public.app_role[]
     ) then
    return;  -- no rows, rather than an error: the caller simply has no buyers
  end if;

  return query
    select p.id, p.full_name, p.email
    from public.profiles p
    where p.role = 'buyer'
    order by p.full_name nulls last, p.email;
end $function$;

create or replace function public.assigned_buyer_counts(p_sheet_id uuid)
 returns table(buyer_id uuid, lines bigint)
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select assigned_buyer, count(*)
  from public.rm_requirement
  where rm_sheet_id = p_sheet_id
    and assigned_buyer is not null
  group by assigned_buyer;
$function$;

create or replace function public.assign_buyers(p_sheet_id uuid, p_assignments jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
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
    select
      ord,
      nullif(e ->> 'category', '')                  as category,
      nullif(upper(btrim(e ->> 'itemCode')), '')    as item_code,
      nullif(e ->> 'buyerId', '')::uuid             as buyer_id
    from jsonb_array_elements(p_assignments) with ordinality as t(e, ord)
  ),
  lines as (
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
     and r.assigned_buyer is distinct from c.buyer_id;
  get diagnostics v_updated = row_count;

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
end $function$;

create or replace function public.add_working_hours(p_start timestamp with time zone, p_hours numeric)
 returns timestamp with time zone
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  cur timestamptz := p_start;
  remaining_min numeric := p_hours * 60;
  step int := 15;
  loc timestamp;
  d int;
  h numeric;
begin
  while remaining_min > 0 loop
    cur := cur + make_interval(mins => step);
    loc := cur at time zone 'Asia/Kolkata';
    d := extract(isodow from loc);                    -- 1=Mon .. 7=Sun
    h := extract(hour from loc) + extract(minute from loc) / 60.0;
    if d <= 6 and h > 10 and h <= 19.5 then           -- Mon–Sat, 10:00–19:30
      remaining_min := remaining_min - step;
    end if;
  end loop;
  return cur;
end;
$function$;

create or replace function public.replace_grn_rows(p_grc_numbers text[], p_rows jsonb)
 returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
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
end $function$;

create or replace function public.replace_rm_requirements(p_sheet_id uuid, p_rows jsonb)
 returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
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
end $function$;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.prevent_role_escalation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (new.role is distinct from old.role)
     and auth.uid() is not null
     and not public.has_role('admin') then
    raise exception 'Only admin can change a user role';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so the caller's RLS on the base tables applies)
-- ---------------------------------------------------------------------------

create or replace view public.reconciliation
  with (security_invoker = true) as
 with req as (
         select rm_requirement.rm_sheet_id,
            rm_requirement.item_code,
            rm_requirement.lot,
            rm_requirement.location,
            sum(rm_requirement.required_qty) as required
           from rm_requirement
          where rm_requirement.item_code is not null
          group by rm_requirement.rm_sheet_id, rm_requirement.item_code, rm_requirement.lot, rm_requirement.location
        ), ord as (
         select p.rm_sheet_id,
            l.item_code,
            l.lot,
            l.location,
            sum(l.ordered_qty) filter (where p.status <> 'draft'::text) as ordered,
            sum(l.ordered_qty) filter (where p.status = 'draft'::text) as drafted,
            max(nullif(l.moq, 0::numeric)) filter (where p.status <> 'draft'::text) as po_moq
           from po_line l
             join po p on p.id = l.po_id
          where l.item_code is not null
          group by p.rm_sheet_id, l.item_code, l.lot, l.location
        ), joined as (
         select coalesce(req.rm_sheet_id, ord.rm_sheet_id) as rm_sheet_id,
            coalesce(req.item_code, ord.item_code) as item_code,
            coalesce(req.lot, ord.lot) as lot,
            coalesce(req.location, ord.location) as location,
            coalesce(req.required, 0::numeric) as required,
            coalesce(ord.ordered, 0::numeric) as ordered,
            coalesce(ord.drafted, 0::numeric) as drafted,
            ord.po_moq
           from req
             full join ord on req.rm_sheet_id = ord.rm_sheet_id and req.item_code = ord.item_code and not req.lot is distinct from ord.lot and not req.location is distinct from ord.location
        ), calc as (
         select j.rm_sheet_id,
            j.item_code,
            j.lot,
            j.location,
            j.required,
            j.ordered,
            j.drafted,
            j.po_moq,
            im.name,
            im.category,
            im.base_unit,
            coalesce(nullif(j.po_moq, 0::numeric), nullif(im.moq, 0::numeric), 0::numeric) as moq
           from joined j
             left join item_master im on im.item_code = j.item_code
        )
 select rm_sheet_id,
    item_code,
    lot,
    location,
    name,
    category,
    base_unit,
    required,
    ordered,
    drafted,
    moq,
        case
            when moq > 0::numeric then ceil(required / moq) * moq
            else required
        end as expected_max,
    greatest(required * 0.015, 2::numeric) as tol,
    round(ordered - required, 3) as variance,
        case
            when required > 0::numeric and ordered = 0::numeric and drafted > 0::numeric then 'drafted_only'::text
            when required > 0::numeric and ordered = 0::numeric then 'not_bought'::text
            when required = 0::numeric and ordered > 0::numeric then 'extra_not_in_sheet'::text
            when ordered < (required - greatest(required * 0.015, 2::numeric)) then 'partial'::text
            when ordered > (
            case
                when moq > 0::numeric then ceil(required / moq) * moq
                else required
            end + greatest(required * 0.015, 2::numeric)) then 'over_buy'::text
            else 'on_target'::text
        end as status,
    ordered > (required + greatest(required * 0.015, 2::numeric)) and ordered <= (
        case
            when moq > 0::numeric then ceil(required / moq) * moq
            else required
        end + greatest(required * 0.015, 2::numeric)) as moq_forced
   from calc;
comment on view public.reconciliation is
  'Requirement against what has actually been ordered. Draft POs are reported separately in drafted and excluded from ordered - a draft is private to the buyer and commits nobody. security_invoker so RLS still applies.';

create or replace view public.grn_ours
  with (security_invoker = true) as
 select id, grc_no, grc_date, po_number, po_date, item_code, lot, item_name,
    qty, stock_point, supplier, department, doc_no, doc_date, landed_cost,
    remarks, raw, imported_at, imported_by
   from grn g
  where (exists ( select 1
           from po p
          where p.po_number is not null and g.po_number is not null and upper(btrim(p.po_number)) = upper(btrim(g.po_number))));
comment on view public.grn_ours is
  'Receipts against purchase orders raised in this system. The register that arrives by email is company-wide; this is the part that can be reconciled. Everything is still stored in grn, so a PO number captured later brings its receipts into view rather than having lost them. security_invoker, so the callers policies on grn and po still apply.';

create or replace view public.po_delivery
  with (security_invoker = true) as
 select p.id as po_id,
        case
            when count(distinct l.etd) = 1 then min(l.etd)
            else null::date
        end as etd,
        case
            when count(distinct l.site) = 1 then min(l.site)
            else null::text
        end as site,
    count(distinct l.etd) as distinct_etds,
    count(distinct l.site) as distinct_sites
   from po p
     left join po_line l on l.po_id = p.id
  group by p.id;
comment on view public.po_delivery is
  'Order-level ETD and site: the agreed value when every line shares one, null when they differ. security_invoker so the callers policies on po and po_line still apply.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Mirror every new auth user into public.profiles.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only an admin may change a role; enforced in the database, not just the UI.
drop trigger if exists profiles_no_role_escalation on public.profiles;
create trigger profiles_no_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- ---------------------------------------------------------------------------
-- Row-level security — the actual access boundary
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.item_master    enable row level security;
alter table public.uom_conversion enable row level security;
alter table public.rm_sheet       enable row level security;
alter table public.rm_requirement enable row level security;
alter table public.po             enable row level security;
alter table public.po_line        enable row level security;
alter table public.approval       enable row level security;
alter table public.audit_log      enable row level security;
alter table public.escalation     enable row level security;
alter table public.grn            enable row level security;
alter table public.grn_mail       enable row level security;

-- profiles
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles as permissive for all to authenticated
  using (has_role(variadic array['admin'::app_role]))
  with check (has_role(variadic array['admin'::app_role]));
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles as permissive for select to authenticated
  using ((id = auth.uid()) or has_role(variadic array['admin'::app_role]));
drop policy if exists profiles_select_staff on public.profiles;
create policy profiles_select_staff on public.profiles as permissive for select to authenticated
  using (is_staff());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles as permissive for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- item_master
drop policy if exists item_master_admin_write on public.item_master;
create policy item_master_admin_write on public.item_master as permissive for all to authenticated
  using (has_role(variadic array['admin'::app_role]))
  with check (has_role(variadic array['admin'::app_role]));
drop policy if exists item_master_insert_uploader on public.item_master;
create policy item_master_insert_uploader on public.item_master as permissive for insert to public
  with check (has_role(variadic array['uploader'::app_role, 'purchase_head'::app_role, 'admin'::app_role]));
drop policy if exists item_master_read on public.item_master;
create policy item_master_read on public.item_master as permissive for select to authenticated
  using (true);

-- uom_conversion
drop policy if exists uom_admin_write on public.uom_conversion;
create policy uom_admin_write on public.uom_conversion as permissive for all to authenticated
  using (has_role(variadic array['admin'::app_role]))
  with check (has_role(variadic array['admin'::app_role]));
drop policy if exists uom_read on public.uom_conversion;
create policy uom_read on public.uom_conversion as permissive for select to authenticated
  using (true);

-- rm_sheet
drop policy if exists rm_sheet_delete_admin on public.rm_sheet;
create policy rm_sheet_delete_admin on public.rm_sheet as permissive for delete to public
  using (has_role(variadic array['admin'::app_role]));
drop policy if exists rm_sheet_insert_uploader on public.rm_sheet;
create policy rm_sheet_insert_uploader on public.rm_sheet as permissive for insert to authenticated
  with check (has_role(variadic array['uploader'::app_role, 'admin'::app_role]) and (uploaded_by = auth.uid()));
drop policy if exists rm_sheet_select on public.rm_sheet;
create policy rm_sheet_select on public.rm_sheet as permissive for select to authenticated
  using ((uploaded_by = auth.uid()) or is_staff() or buyer_on_sheet(id));
drop policy if exists rm_sheet_update_staff on public.rm_sheet;
create policy rm_sheet_update_staff on public.rm_sheet as permissive for update to authenticated
  using (has_role(variadic array['purchase_head'::app_role, 'approver'::app_role, 'md'::app_role, 'admin'::app_role]))
  with check (has_role(variadic array['purchase_head'::app_role, 'approver'::app_role, 'md'::app_role, 'admin'::app_role]));
drop policy if exists rm_sheet_update_uploader on public.rm_sheet;
create policy rm_sheet_update_uploader on public.rm_sheet as permissive for update to public
  using (uploaded_by = auth.uid()) with check (uploaded_by = auth.uid());

-- rm_requirement
drop policy if exists rm_req_write_head on public.rm_requirement;
create policy rm_req_write_head on public.rm_requirement as permissive for all to authenticated
  using (has_role(variadic array['purchase_head'::app_role, 'admin'::app_role]))
  with check (has_role(variadic array['purchase_head'::app_role, 'admin'::app_role]));
drop policy if exists rm_req_delete_owner on public.rm_requirement;
create policy rm_req_delete_owner on public.rm_requirement as permissive for delete to authenticated
  using (exists ( select 1 from rm_sheet s where ((s.id = rm_requirement.rm_sheet_id) and (s.uploaded_by = auth.uid()))));
drop policy if exists rm_requirement_delete_admin on public.rm_requirement;
create policy rm_requirement_delete_admin on public.rm_requirement as permissive for delete to public
  using (has_role(variadic array['admin'::app_role]));
drop policy if exists rm_req_insert_owner on public.rm_requirement;
create policy rm_req_insert_owner on public.rm_requirement as permissive for insert to authenticated
  with check (exists ( select 1 from rm_sheet s where ((s.id = rm_requirement.rm_sheet_id) and (s.uploaded_by = auth.uid()))));
drop policy if exists rm_req_select on public.rm_requirement;
create policy rm_req_select on public.rm_requirement as permissive for select to authenticated
  using ((assigned_buyer = auth.uid()) or is_staff() or (exists ( select 1 from rm_sheet s where ((s.id = rm_requirement.rm_sheet_id) and (s.uploaded_by = auth.uid())))));
drop policy if exists rm_req_update_uploader on public.rm_requirement;
create policy rm_req_update_uploader on public.rm_requirement as permissive for update to public
  using (exists ( select 1 from rm_sheet s where ((s.id = rm_requirement.rm_sheet_id) and (s.uploaded_by = auth.uid()))))
  with check (exists ( select 1 from rm_sheet s where ((s.id = rm_requirement.rm_sheet_id) and (s.uploaded_by = auth.uid()))));

-- po
drop policy if exists po_delete_creator_or_admin on public.po;
create policy po_delete_creator_or_admin on public.po as permissive for delete to public
  using ((created_by = auth.uid()) or has_role(variadic array['admin'::app_role]));
drop policy if exists po_insert_buyer on public.po;
create policy po_insert_buyer on public.po as permissive for insert to authenticated
  with check (has_role(variadic array['buyer'::app_role, 'admin'::app_role]) and (created_by = auth.uid()));
drop policy if exists po_select on public.po;
create policy po_select on public.po as permissive for select to authenticated
  using ((created_by = auth.uid()) or is_staff());
drop policy if exists po_update on public.po;
create policy po_update on public.po as permissive for update to authenticated
  using (((created_by = auth.uid()) and (status = 'draft'::text)) or has_role(variadic array['po_team'::app_role, 'admin'::app_role]))
  with check ((created_by = auth.uid()) or has_role(variadic array['po_team'::app_role, 'admin'::app_role]));
drop policy if exists po_update_approver on public.po;
create policy po_update_approver on public.po as permissive for update to public
  using (has_role(variadic array['approver'::app_role, 'admin'::app_role]))
  with check (has_role(variadic array['approver'::app_role, 'admin'::app_role]));

-- po_line
drop policy if exists po_line_write_buyer on public.po_line;
create policy po_line_write_buyer on public.po_line as permissive for all to authenticated
  using ((exists ( select 1 from po x where ((x.id = po_line.po_id) and (x.created_by = auth.uid())))) or has_role(variadic array['admin'::app_role]))
  with check ((exists ( select 1 from po x where ((x.id = po_line.po_id) and (x.created_by = auth.uid())))) or has_role(variadic array['admin'::app_role]));
drop policy if exists po_line_delete_via_po on public.po_line;
create policy po_line_delete_via_po on public.po_line as permissive for delete to public
  using ((exists ( select 1 from po x where ((x.id = po_line.po_id) and (x.created_by = auth.uid())))) or has_role(variadic array['admin'::app_role]));
drop policy if exists po_line_select on public.po_line;
create policy po_line_select on public.po_line as permissive for select to authenticated
  using (can_see_po(po_id));

-- approval
drop policy if exists approval_delete_admin on public.approval;
create policy approval_delete_admin on public.approval as permissive for delete to public
  using (has_role(variadic array['admin'::app_role]));
drop policy if exists approval_insert_approver on public.approval;
create policy approval_insert_approver on public.approval as permissive for insert to authenticated
  with check (has_role(variadic array['approver'::app_role, 'admin'::app_role]));
drop policy if exists approval_select on public.approval;
create policy approval_select on public.approval as permissive for select to authenticated
  using (has_role(variadic array['approver'::app_role, 'md'::app_role, 'admin'::app_role, 'purchase_head'::app_role]));
drop policy if exists approval_update on public.approval;
create policy approval_update on public.approval as permissive for update to authenticated
  using (has_role(variadic array['approver'::app_role, 'md'::app_role, 'admin'::app_role]))
  with check (has_role(variadic array['approver'::app_role, 'md'::app_role, 'admin'::app_role]));

-- audit_log
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log as permissive for insert to authenticated
  with check (actor_id = auth.uid());
drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log as permissive for select to authenticated
  using (has_role(variadic array['admin'::app_role, 'md'::app_role]));
drop policy if exists audit_select_self on public.audit_log;
create policy audit_select_self on public.audit_log as permissive for select to authenticated
  using (actor_id = auth.uid());

-- escalation
drop policy if exists escalation_delete_admin on public.escalation;
create policy escalation_delete_admin on public.escalation as permissive for delete to public
  using (has_role(variadic array['admin'::app_role]));
drop policy if exists escalation_insert on public.escalation;
create policy escalation_insert on public.escalation as permissive for insert to authenticated
  with check (has_role(variadic array['approver'::app_role, 'admin'::app_role]) and (raised_by = auth.uid()));
drop policy if exists escalation_select on public.escalation;
create policy escalation_select on public.escalation as permissive for select to authenticated
  using (is_staff() or (assigned_buyer = auth.uid()) or (raised_by = auth.uid()));
drop policy if exists escalation_update on public.escalation;
create policy escalation_update on public.escalation as permissive for update to authenticated
  using (is_staff() or (assigned_buyer = auth.uid()))
  with check (is_staff() or (assigned_buyer = auth.uid()));

-- grn
drop policy if exists grn_write on public.grn;
create policy grn_write on public.grn as permissive for all to public
  using (has_role(variadic array['po_team'::app_role, 'purchase_head'::app_role, 'admin'::app_role]))
  with check (has_role(variadic array['po_team'::app_role, 'purchase_head'::app_role, 'admin'::app_role]));
drop policy if exists grn_select on public.grn;
create policy grn_select on public.grn as permissive for select to public
  using (is_staff() or (exists ( select 1 from po p
    where ((p.created_by = auth.uid()) and (p.po_number is not null) and (grn.po_number is not null)
      and (upper(btrim(p.po_number)) = upper(btrim(grn.po_number)))))));

-- grn_mail
drop policy if exists grn_mail_write on public.grn_mail;
create policy grn_mail_write on public.grn_mail as permissive for all to public
  using (has_role(variadic array['po_team'::app_role, 'purchase_head'::app_role, 'admin'::app_role]))
  with check (has_role(variadic array['po_team'::app_role, 'purchase_head'::app_role, 'admin'::app_role]));
drop policy if exists grn_mail_select on public.grn_mail;
create policy grn_mail_select on public.grn_mail as permissive for select to public
  using (is_staff());

-- ---------------------------------------------------------------------------
-- Function EXECUTE grants
--
-- Supabase's default privileges grant EXECUTE on every new function in this
-- schema to BOTH anon and authenticated. Anonymous callers have no business
-- reaching these — emails_for_role in particular would hand the publishable
-- key holder every admin's address — so anon is revoked explicitly. (Revoking
-- from PUBLIC does not remove the explicit anon grant; see
-- 20260821_revoke_anon_execute.sql.) Trigger functions are called by the
-- database, never by a client, so both roles are revoked.
-- ---------------------------------------------------------------------------
revoke execute on function public.has_role(variadic public.app_role[]) from anon;
revoke execute on function public.is_staff() from anon;
revoke execute on function public.my_role() from anon;
revoke execute on function public.buyer_on_sheet(uuid) from anon;
revoke execute on function public.can_see_po(uuid) from anon;
revoke execute on function public.emails_for_role(public.app_role) from anon;
revoke execute on function public.buyers_for_assignment() from anon;
revoke execute on function public.assigned_buyer_counts(uuid) from anon;
revoke execute on function public.assign_buyers(uuid, jsonb) from anon;
revoke execute on function public.replace_grn_rows(text[], jsonb) from anon;
revoke execute on function public.replace_rm_requirements(uuid, jsonb) from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.prevent_role_escalation() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets and their policies
--
-- db pull does not capture these. Both buckets are private; access is governed
-- entirely by the policies below on storage.objects.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rm-sheets', 'rm-sheets', false), ('po-docs', 'po-docs', false)
on conflict (id) do nothing;

drop policy if exists rm_sheets_insert_owner on storage.objects;
create policy rm_sheets_insert_owner on storage.objects as permissive for insert to authenticated
  with check ((bucket_id = 'rm-sheets'::text) and (owner = auth.uid())
    and has_role(variadic array['uploader'::app_role, 'admin'::app_role]));
drop policy if exists rm_sheets_select on storage.objects;
create policy rm_sheets_select on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'rm-sheets'::text) and ((owner = auth.uid()) or is_staff()));
drop policy if exists po_docs_insert on storage.objects;
create policy po_docs_insert on storage.objects as permissive for insert to authenticated
  with check ((bucket_id = 'po-docs'::text) and (owner = auth.uid())
    and has_role(variadic array['po_team'::app_role, 'admin'::app_role]));
drop policy if exists po_docs_select on storage.objects;
create policy po_docs_select on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'po-docs'::text) and ((owner = auth.uid()) or is_staff()));

-- ---------------------------------------------------------------------------
-- Scheduled job: auto-escalate overdue escalations to the MD every 15 minutes.
--
-- pg_net is not installed, so this can only flip the status; the actual mail is
-- sent by the FastAPI service. Guarded so the migration still applies where
-- pg_cron is unavailable.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'auto_escalate_to_md') then
      perform cron.schedule(
        'auto_escalate_to_md',
        '*/15 * * * *',
        $job$update public.escalation
              set status = 'md_escalated', escalated_to_md_at = now()
            where status = 'open' and now() >= escalate_after$job$
      );
    end if;
  else
    raise notice 'pg_cron not installed; auto_escalate_to_md not scheduled.';
  end if;
end $$;
