-- Approval moves to the purchase order.
--
-- It was per RM sheet: one approval row, sent on to the MD for final sign-off.
-- That never matched how the work is done — a sheet becomes many POs to many
-- suppliers, and approving "the sheet" says nothing about which order was
-- agreed to. The approver now approves a PO, and is final: the MD sees only
-- what is escalated to them.
--
-- Kept separate from po.status (draft -> sent -> uploaded), which tracks where
-- the document is. A PO can have its document attached and still be waiting for
-- approval, and collapsing the two would make one unreadable from the other.

alter table public.po
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_by     uuid references auth.users (id),
  add column if not exists approved_at     timestamptz,
  add column if not exists approval_note   text;

comment on column public.po.approval_status is
  'pending | approved. The approver is final; the MD only sees escalations.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.po'::regclass and conname = 'po_approval_status_check'
  ) then
    alter table public.po
      add constraint po_approval_status_check
      check (approval_status in ('pending', 'approved'));
  end if;
end $$;

-- The approvals list filters on this, and it is read on every load of the
-- approver's screen.
create index if not exists po_approval_status_idx
  on public.po (approval_status)
  where approval_status = 'pending';

-- The approver needs to write those columns. The existing po_update policy
-- covers the creating buyer while a draft, and the PO team thereafter; neither
-- includes the approver.
drop policy if exists po_update_approver on public.po;
create policy po_update_approver
  on public.po for update
  using      (public.has_role(variadic array['approver', 'admin']::public.app_role[]))
  with check (public.has_role(variadic array['approver', 'admin']::public.app_role[]));


-- Escalation gains the purchase order it concerns.
--
-- Escalations were raised against (sheet, item, lot) from the reconciliation
-- view. An approver reviewing a PO is escalating THAT order — the supplier and
-- the number are the whole point of the message — and without this the buyer
-- receives "this item is short" with no reference they can act on.
alter table public.escalation
  add column if not exists po_id uuid references public.po (id) on delete cascade;

comment on column public.escalation.po_id is
  'The purchase order escalated, when raised from the PO approvals screen.';

create index if not exists escalation_po_id_idx
  on public.escalation (po_id)
  where po_id is not null;

-- item_code is required for a sheet-level escalation but meaningless for a
-- whole-PO one, so it must be allowed to be null.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'escalation'
      and column_name = 'item_code' and is_nullable = 'NO'
  ) then
    alter table public.escalation alter column item_code drop not null;
  end if;
end $$;
