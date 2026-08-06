-- Goods received, imported from the GRN (GRC) register.
--
-- One row per receipt line, matching the register's own shape. A PO is
-- received against by (PO NO., BARCODE, LOT NO.) — the same identifiers the
-- register already carries, which is why po.po_number had to be captured from
-- the attached document first.
--
-- Quantities are PER RECEIPT, not cumulative: a part delivery produces one row
-- now and another later under a different GRC number, and the received total is
-- their sum. Storing them per receipt keeps the delivery history rather than
-- flattening it to a running figure that cannot be audited.

create table if not exists public.grn (
  id           uuid primary key default gen_random_uuid(),

  -- Identity of the receipt itself.
  grc_no       text not null,
  grc_date     date,

  -- The join back to a purchase order. po_number is text rather than a foreign
  -- key to po.id: the register is produced by another system that knows only
  -- the printed number, and a receipt can legitimately arrive for a PO this
  -- system has not seen yet.
  po_number    text,
  po_date      date,

  -- The line.
  item_code    text,
  lot          text,
  item_name    text,
  qty          numeric not null default 0,

  -- Context carried through for the audit trail and for matching by hand when
  -- the automatic match fails.
  stock_point  text,
  supplier     text,
  department   text,
  doc_no       text,
  doc_date     date,
  landed_cost  numeric,
  remarks      text,

  -- Unused since 20260813. Holding every cell of every row here kept a second
  -- copy of the whole spreadsheet in memory and shipped it to the database,
  -- which exhausted the hosted instance and had the process killed mid-import.
  -- Left in place because dropping a column is not worth a migration; the
  -- source file is the diagnosis.
  raw          jsonb,

  imported_at  timestamptz not null default now(),
  imported_by  uuid references auth.users (id)
);

-- Re-importing a register must not double-count. A receipt line is identified
-- by its GRC number plus the item and lot it is for; rows repeated within one
-- file are summed at import so this stays a true natural key.
create unique index if not exists grn_receipt_line_key
  on public.grn (grc_no, coalesce(item_code, ''), coalesce(lot, ''));

-- The matching query goes from a PO to its receipts.
create index if not exists grn_po_number_idx on public.grn (po_number);
create index if not exists grn_item_idx      on public.grn (item_code, lot);

alter table public.grn enable row level security;

-- Everyone on the procurement side reads receipts: the approver needs them for
-- the pending-PO view, the buyer to see what has landed.
drop policy if exists grn_select on public.grn;
create policy grn_select
  on public.grn for select
  using (public.is_staff());

-- Importing is a PO-team/admin action, matching who handles PO documents.
drop policy if exists grn_write on public.grn;
create policy grn_write
  on public.grn for all
  using      (public.has_role(variadic array['po_team', 'purchase_head', 'admin']::public.app_role[]))
  with check (public.has_role(variadic array['po_team', 'purchase_head', 'admin']::public.app_role[]));

comment on table public.grn is
  'Goods received register lines, imported from the GRC export. Quantities are
   per receipt; sum them per (po_number, item_code, lot) for the received total.';
