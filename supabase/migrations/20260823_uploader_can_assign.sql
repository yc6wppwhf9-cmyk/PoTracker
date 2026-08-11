-- The uploader assigns the buyers.
--
-- At HSCVPL the person who uploads the RM sheet is the person who decides which
-- buyer takes which material. There is no separate purchase head doing the
-- routing, so that step belonged to a role nobody holds.
--
-- Scoped to their OWN sheets. A purchase head routes anything; an uploader
-- routes what they uploaded, which is the work in front of them and nothing
-- else. That is a real restriction, not a formality: an uploader can otherwise
-- reassign material on a sheet somebody else is mid-way through buying.

-- 1. Writing the assignment.
--
-- rm_req_write_head covers purchase_head and admin. This adds the uploader for
-- lines belonging to a sheet they uploaded, and nothing more — the existing
-- policy is left exactly as it is.
drop policy if exists rm_req_update_uploader on public.rm_requirement;
create policy rm_req_update_uploader
  on public.rm_requirement for update
  using (
    exists (
      select 1 from public.rm_sheet s
      where s.id = rm_requirement.rm_sheet_id
        and s.uploaded_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.rm_sheet s
      where s.id = rm_requirement.rm_sheet_id
        and s.uploaded_by = auth.uid()
    )
  );

comment on policy rm_req_update_uploader on public.rm_requirement is
  'An uploader may set assigned_buyer on lines of a sheet they uploaded.';


-- 2. Marking the sheet assigned.
--
-- assign_buyers() sets rm_sheet.status once every matched line has a buyer, and
-- it is SECURITY INVOKER — so without this the assignment would write the lines
-- and then silently fail to move the sheet on.
drop policy if exists rm_sheet_update_uploader on public.rm_sheet;
create policy rm_sheet_update_uploader
  on public.rm_sheet for update
  using      (uploaded_by = auth.uid())
  with check (uploaded_by = auth.uid());

comment on policy rm_sheet_update_uploader on public.rm_sheet is
  'An uploader may update a sheet they uploaded — in practice its status, as
   assignment progresses.';


-- 3. Seeing who the buyers are.
--
-- The assignment screen lists buyers from `profiles`, and RLS there scopes a
-- non-staff user to their own row. An uploader is not staff, so the dropdown
-- came back empty — with no error, because an empty list is a perfectly valid
-- result. They would have seen a screen that worked and offered nobody.
--
-- Widening the profiles policy would let every signed-in user read every
-- profile. This exposes exactly the buyers, exactly to the people who route
-- work to them.
create or replace function public.buyers_for_assignment()
returns table (id uuid, full_name text, email text)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
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
end $$;

comment on function public.buyers_for_assignment() is
  'Buyers, for the assignment screen. SECURITY DEFINER so an uploader — who
   cannot read other profiles — can still route work to them; returns nothing
   to anyone who does not do the routing.';

revoke all on function public.buyers_for_assignment() from public;
revoke execute on function public.buyers_for_assignment() from anon;
grant execute on function public.buyers_for_assignment() to authenticated;

-- Verify, signed in as the uploader:
--   select * from public.buyers_for_assignment();   -- the buyers
--   select public.assign_buyers(<their sheet id>, '[]'::jsonb);  -- no error
