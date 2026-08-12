-- Which filter settings rejected a message.
--
-- The scheduled fetch leaves skipped mail UNREAD on purpose: a message rejected
-- by a mistyped filter has to be findable once the filter is corrected. That
-- was learned the hard way — the first real register was consumed and lost
-- because the subject filter said "GRN REPORT" and the subject read
-- "GRN  REPORT".
--
-- But mail that is never accepted and never marked read accumulates, and the
-- fetch takes the oldest N matches. Fifty PO emails from the ERP filled the
-- window completely: every run re-read the same fifty, rejected all fifty, and
-- a register behind them could not be reached. Twice now, at two different
-- scopes.
--
-- Recording the filter settings alongside the rejection resolves the two
-- requirements. A message already rejected under the settings currently in
-- force needs no second look, so it stops occupying the window. Change the
-- senders or the subject and the key changes with them, so every previously
-- rejected message becomes a candidate again — which is the behaviour the
-- leave-it-unread rule existed to protect.
--
-- Null for rows written before this, and for imported and failed rows, where
-- the question does not arise.

alter table public.grn_mail
  add column if not exists filter_key text;

-- The fetch asks "which messages did THIS filter already reject?" on every run.
create index if not exists grn_mail_filter_key_idx
  on public.grn_mail (filter_key)
  where status = 'skipped';

comment on column public.grn_mail.filter_key is
  'Fingerprint of GRN_ALLOWED_SENDERS + GRN_SUBJECT_CONTAINS at the time the
   message was rejected. A message already rejected under the current settings
   is not fetched again; changing the settings changes the key and gives every
   rejected message a fresh hearing.';
