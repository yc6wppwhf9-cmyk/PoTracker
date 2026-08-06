-- Allow po.status = 'sent'.
--
-- A PO now moves draft -> sent -> uploaded. 'sent' is the point at which the
-- buyer hands the draft to the PO team: before it, the PO is private to the
-- buyer and nobody is notified; after it, the PO team can see it and attach the
-- document. The original constraint predates that step, so sending fails with
--
--   new row for relation "po" violates check constraint "po_status_check"
--
-- Any status already present in the table is carried over rather than assumed.
-- Writing out a fixed list would drop a value some existing row still holds,
-- and the ALTER would then fail against exactly the data it was meant to
-- preserve.

do $$
declare
  allowed text[];
  con     text;
begin
  -- Everything the app uses, plus anything already stored.
  select array(
           select distinct s
           from (
             select unnest(array['draft', 'sent', 'uploaded']) as s
             union
             select distinct status from public.po where status is not null
           ) t
           order by s
         )
    into allowed;

  -- Drop whatever the constraint is currently called: it may not be the
  -- default name if it was created inline with a different one.
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.po'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.po drop constraint %I', con);
    raise notice 'dropped constraint %', con;
  end loop;

  execute format(
    'alter table public.po add constraint po_status_check check (status = any (%L::text[]))',
    allowed
  );
  raise notice 'po.status now allows: %', allowed;
end $$;

-- Verify:
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.po'::regclass and conname = 'po_status_check';
