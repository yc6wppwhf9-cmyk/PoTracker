-- The PO team no longer edits ordered quantities.
--
-- They were given this to reconcile a draft against the signed document. In
-- practice the quantity on the PO is the buyer's decision and the signed
-- document is produced FROM it — so an editable field there let the record be
-- quietly moved to match the paperwork, in the one place where a mismatch
-- between the two is the thing worth noticing.
--
-- The screen is read-only now, but a policy is what actually decides: without
-- this, the capability remains for anyone posting directly to the API.
--
-- Their real job is unaffected — attaching the document and capturing the PO
-- number are writes to `po`, not `po_line`.

drop policy if exists po_line_update_po_team on public.po_line;

-- Admins keep it, via po_line_write_buyer's existing `or has_role('admin')`.
-- The buyer keeps it for their own POs through the same policy, which is what
-- their per-line ETD and delivery site depend on.

-- Verify — should return po_line_select, po_line_write_buyer and
-- po_line_delete_via_po, with no po_team update policy:
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'po_line';
