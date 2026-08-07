-- Give the automated GRN account the role it needs, and prove it worked.
--
-- The account signs in like a person and is bound by the same RLS, so without
-- a profiles row carrying po_team it authenticates fine and is then refused on
-- every write — which surfaces as a fetch that collects mail and imports
-- nothing.
--
-- Safe to re-run. Works whether or not a profiles row was created for the user
-- automatically.

do $$
declare
  v_email text := 'grn@hscvpl.com';   -- the Supabase account, not the mailbox
  v_id    uuid;
begin
  select id into v_id from auth.users where email = v_email;
  if v_id is null then
    raise exception 'No auth user with email % — create it under Authentication → Users first.', v_email;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (v_id, v_email, 'GRN import (automated)', 'po_team')
  on conflict (id) do update
    set role      = 'po_team',
        email     = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);

  raise notice 'grn bot ready: % (%)', v_email, v_id;
end $$;

-- Confirm. role must read po_team.
select id, email, full_name, role
from public.profiles
where email = 'grn@hscvpl.com';

-- And that notifications can still find everyone, which is the same lookup the
-- fetch depends on for nothing and the rest of the app depends on for mail.
select 'purchase_head' as role, public.emails_for_role('purchase_head'::public.app_role) as email
union all select 'po_team',  public.emails_for_role('po_team'::public.app_role)
union all select 'approver', public.emails_for_role('approver'::public.app_role)
union all select 'buyer',    public.emails_for_role('buyer'::public.app_role)
union all select 'md',       public.emails_for_role('md'::public.app_role);
