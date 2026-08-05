-- A record of every GRN register email the scheduled job has handled.
--
-- Two jobs at once:
--
--   * Not importing one message twice. The mailbox's own read flag is not
--     enough — a person opening the mail would mark it read and the register
--     would never be imported at all.
--   * Saying whether the job is actually running. A scheduled task that stops
--     silently is worse than one that never existed, because nobody looks.
--     A row per attempt, failures included, makes "when did we last receive a
--     register?" answerable.

create table if not exists public.grn_mail (
  id           uuid primary key default gen_random_uuid(),
  message_id   text not null,
  sender       text,
  subject      text,
  filename     text,
  status       text not null default 'imported',  -- imported | skipped | failed
  detail       text,
  lines        integer not null default 0,
  processed_at timestamptz not null default now(),
  processed_by uuid references auth.users (id)
);

-- One row per message: the uniqueness IS the don't-import-twice guarantee.
create unique index if not exists grn_mail_message_id_key
  on public.grn_mail (message_id);

create index if not exists grn_mail_processed_at_idx
  on public.grn_mail (processed_at desc);

alter table public.grn_mail enable row level security;

drop policy if exists grn_mail_select on public.grn_mail;
create policy grn_mail_select
  on public.grn_mail for select
  using (public.is_staff());

-- Written by the service account, which holds po_team.
drop policy if exists grn_mail_write on public.grn_mail;
create policy grn_mail_write
  on public.grn_mail for all
  using      (public.has_role(variadic array['po_team', 'purchase_head', 'admin']::public.app_role[]))
  with check (public.has_role(variadic array['po_team', 'purchase_head', 'admin']::public.app_role[]));

comment on table public.grn_mail is
  'One row per GRN register email seen by the scheduled fetch. Unique on
   message_id, which is what stops a message being imported twice.';
