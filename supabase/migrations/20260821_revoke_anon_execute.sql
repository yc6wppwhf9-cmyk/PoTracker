-- Close four functions that could be called without signing in.
--
-- The worst is `emails_for_role`. It is SECURITY DEFINER — it exists precisely
-- so a caller who cannot read `profiles` can still resolve a role's addresses
-- — and `anon` could execute it. The publishable key is in the browser bundle
-- by design, so anyone at all could POST to
--
--     /rest/v1/rpc/emails_for_role   {"p_role": "admin"}
--
-- and be handed the email address of every administrator, purchase head and
-- buyer in the company. Not a data breach in the dramatic sense; an excellent
-- phishing list, which is how most breaches actually start.
--
-- WHY IT WAS OPEN, since the migration that created it looks careful:
--
--     revoke all on function ... from public;
--     grant execute on function ... to authenticated;
--
-- `public` is the implicit catch-all role, and revoking from it does nothing
-- about an EXPLICIT grant to `anon`. Supabase ships default privileges that
-- grant EXECUTE on every new function in this schema to both `anon` and
-- `authenticated`, so the grant was already there before the revoke ran, and
-- survived it. Revoking from `public` and granting to `authenticated` looks
-- like a closed door and is not one.
--
-- The other three are lower stakes — they need a caller identity to return
-- anything useful — but there is no reason for an anonymous visitor to reach
-- them, and the same mistake produced all four.

revoke execute on function public.emails_for_role(public.app_role) from anon;
revoke execute on function public.assign_buyers(uuid, jsonb) from anon;
revoke execute on function public.assigned_buyer_counts(uuid) from anon;
revoke execute on function public.add_working_hours(timestamptz, numeric) from anon;

-- `add_working_hours` also had no fixed search_path. It is not SECURITY
-- DEFINER, so this is not the classic hijack, but pinning it costs nothing and
-- silences a real advisory rather than teaching people to ignore the list.
do $$
declare
  fn text;
begin
  select p.oid::regprocedure::text into fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'add_working_hours'
  limit 1;

  if fn is not null then
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end if;
end $$;

-- Verify — every row must read false:
--   select p.proname, p.proacl::text like '%anon=X%' as anon_can_execute
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--   order by 2 desc;
