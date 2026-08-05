-- The supplier-facing PO number printed on the attached document, e.g.
-- PO/HSM/00000910/26-27.
--
-- This is the only identifier shared outside the system: it appears on the
-- supplier's invoice and, critically, on the GRN register — so it is the key
-- any goods-received matching must join on. The row's uuid means nothing to
-- anyone outside this database.
--
-- Nullable: a PO has no number until its document is attached. Populated by
-- extraction from the PDF at upload, and correctable by the PO team.

alter table public.po
  add column if not exists po_number text;

comment on column public.po.po_number is
  'Supplier-facing PO number from the attached document. Join key for GRN.';

-- Unique where present. Two POs sharing a number would make GRN matching
-- ambiguous in a way no later code could resolve — better to refuse the
-- duplicate at the point someone types it.
create unique index if not exists po_po_number_key
  on public.po (po_number)
  where po_number is not null;

-- Lookups from the GRN side are by number, which the unique index above serves.
