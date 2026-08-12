# Database schema — captured into version control

The full schema is now in Git as
[`migrations/20260801000000_base_schema.sql`](migrations/20260801000000_base_schema.sql),
read out of the live Supabase project (ref `zpuhlgjuoqrxcakeyhbg`) on
2026-08-12. The repository can recreate the database on its own; it no longer
lives only in the hosted project.

That baseline reproduces the complete current state:

- the tables (`item_master`, `uom_conversion`, `rm_sheet`, `rm_requirement`,
  `po`, `po_line`, `approval`, `escalation`, `audit_log`, `profiles`, `grn`,
  `grn_mail`) with their indexes, constraints and column comments;
- **every RLS policy** — which is the app's actual access-control boundary, not
  the `requireRole()` / `require_roles()` checks in application code — plus the
  function EXECUTE grants that revoke anonymous access;
- the `reconciliation` view, which holds the core business logic
  (`expected_max = ceil(required/moq)*moq`, the tolerance band, the 5-way
  classification, and the `moq_forced` flag), and the `grn_ours` and
  `po_delivery` views, all `security_invoker`;
- the `add_working_hours()`, `has_role()`, `my_role()`, `is_staff()`,
  `buyer_on_sheet()`, `can_see_po()`, `emails_for_role()`,
  `buyers_for_assignment()`, `assign_buyers()`, `assigned_buyer_counts()`,
  `replace_grn_rows()`, `replace_rm_requirements()`, `handle_new_user()` and
  `prevent_role_escalation()` functions;
- the `app_role` enum;
- the `on_auth_user_created` and `profiles_no_role_escalation` triggers;
- the pg_cron job that auto-escalates overdue escalations to the MD;
- the Storage buckets (`rm-sheets`, `po-docs`) and their policies.

The baseline sorts before the dated incremental migrations and is fully
idempotent (`create ... if not exists`, `create or replace`,
`drop policy if exists`), so replaying it against a fresh database creates
everything and the later increments then re-run harmlessly on the finished
schema; replaying it against the live database changes nothing.

## Keep it captured

Make schema changes as new migrations, not by hand in the dashboard — a policy
edited in the SQL editor and not written down puts the repository back out of
step with the live database. [`CAPTURE.md`](CAPTURE.md) explains how the
baseline was pulled and how to refresh it.

`web/src/lib/database.types.ts` is a *generated shadow* of this schema, not a
source of truth — it cannot recreate anything. It is also wrong in at least one
place: it describes `has_role` as taking a single `app_role[]` argument, but the
function is declared `has_role(variadic app_role[])`. A policy that passes a
plain array fails with 42883.

## What the live database actually contains (verified 2026-08-05)

Read out of the running project, so these are facts rather than assumptions:

- **`reconciliation` exists** and joins on `(item_code, lot, location)` using
  `is not distinct from` for the nullable parts, with
  `expected_max = ceil(required/moq)*moq`. Its MOQ is
  `coalesce(po_line.moq, item_master.moq, 0)` — the PO line wins, which is what
  makes supplier-specific MOQ work when the item master has none. Its tolerance
  is `greatest(required * 0.015, 2)`, i.e. 1.5% with a floor of 2 units.
- It is defined `security_invoker=true`, so RLS on the underlying tables is
  enforced for the caller. It is owned by `postgres`; without that setting it
  would have run with the owner's rights and exposed every sheet to every user.
- **Both sides of the view filter `item_code is not null`**, so a requirement
  line that never matched the catalogue is absent from reconciliation entirely
  — not `not_bought`, simply invisible. This is why uploader auto-registration
  into `item_master` matters so much.
- **pg_cron is installed** and runs `auto_escalate_to_md` every 15 minutes.
  **pg_net is not installed**, so that job can only flip `md_escalated`; it
  cannot send mail. All mail originates from the FastAPI service.
- Installed extensions: `pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`,
  `supabase_vault`, `uuid-ossp`.

## Fix this before anything else

Requires the project's database password (Supabase dashboard → Project Settings
→ Database), which is why it has not been done automatically.

```bash
npm install -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <project-ref>
supabase db pull                 # writes supabase/migrations/<timestamp>_remote_schema.sql
git add supabase/migrations && git commit -m "Capture the live schema"
```

Then keep it current — make schema changes locally and push them, rather than
editing in the dashboard:

```bash
supabase migration new add_something
# edit the generated SQL, then:
supabase db push
```

## Regenerating the TypeScript types

After any schema change:

```bash
supabase gen types typescript --project-id <project-ref> > web/src/lib/database.types.ts
```

Types drifting from the live schema is not theoretical here — the
`item_master` importer writes `article_name`, `hsn_code`, and `material_type`,
which do not appear in the generated types. Whichever is stale should be
reconciled once the schema is captured.
