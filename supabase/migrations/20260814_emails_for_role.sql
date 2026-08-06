-- Let a notification find its recipients.
--
-- Every notification resolves addresses with `select email from profiles where
-- role = ...`, run as the person who triggered it. That only works if RLS lets
-- them read the other person's profile row — and it often does not: an uploader
-- is not staff, so uploading a sheet found zero purchase heads and the mail was
-- skipped in silence. The same applies to a buyer notifying the PO team.
--
-- Widening the profiles policy would fix it by letting everyone read everyone's
-- row, which is more than notification needs. This exposes exactly one thing —
-- the addresses for a role — and nothing else about those people.

create or replace function public.emails_for_role(p_role public.app_role)
returns setof text
language sql
security definer
-- Pinned: a SECURITY DEFINER function without this can be redirected by a
-- caller's search_path to a table they control.
set search_path = public, pg_temp
stable
as $$
  select email
  from public.profiles
  where role = p_role
    and email is not null
    and email <> '';
$$;

comment on function public.emails_for_role(public.app_role) is
  'Email addresses for a role, for notifications. SECURITY DEFINER so a sender
   need not be able to read the recipient profile — it returns addresses only.';

-- Any signed-in user may ask, because any of them can trigger a notification.
-- The function reveals no more than the addresses it is asked for.
revoke all on function public.emails_for_role(public.app_role) from public;
grant execute on function public.emails_for_role(public.app_role) to authenticated;

-- Verify:
--   select public.emails_for_role('purchase_head'::public.app_role);
