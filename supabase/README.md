# Database schema — NOT YET IN VERSION CONTROL

⚠️ **The schema for this app currently exists only inside the hosted Supabase
project.** Nothing in this repository can recreate it.

That includes:

- the tables (`item_master`, `uom_conversion`, `rm_sheet`, `rm_requirement`,
  `po`, `po_line`, `approval`, `escalation`, `audit_log`, `profiles`);
- **every RLS policy** — which is the app's actual access-control boundary, not
  the `requireRole()` / `require_roles()` checks in application code;
- the `reconciliation` view, which holds the core business logic
  (`expected_max = ceil(required/moq)*moq`, the tolerance band, the 5-way
  classification, and the `moq_forced` flag);
- the `add_working_hours()`, `has_role()`, `my_role()`, `is_staff()`,
  `buyer_on_sheet()`, and `can_see_po()` functions;
- the `app_role` enum;
- the pg_cron job that auto-escalates overdue escalations to the MD;
- the Storage buckets (`rm-sheets`, `po-docs`) and their policies.

`web/src/lib/database.types.ts` is a *generated shadow* of this schema, not a
source of truth — it cannot recreate anything.

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
