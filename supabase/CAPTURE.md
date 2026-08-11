# Capturing the schema into Git

Run this once. It takes about five minutes and closes the most serious gap in
the repository.

## What is at risk until you do

Everything in `supabase/migrations/` is a *change* applied on top of a base
that exists nowhere but the live database. Restoring from this repository alone
would produce an application with no tables, and — the part that matters —
**no row-level security policies.**

RLS is the access boundary here. `requireRole()` in the web app and
`require_roles()` in the API are conveniences that produce good error messages;
the policies are what actually stop a buyer reading another buyer's orders. If
they were ever lost or altered by hand, nothing in Git would say what they had
been, and the difference between "correct" and "everyone can read everything"
is invisible from the application.

There is also no record of drift. Policies edited in the dashboard over the
past weeks — several were, during this work — exist only as their current
state, with no history of what changed or why.

## Do it

```bash
npm install -g supabase        # or: brew install supabase/tap/supabase
cd supabase
supabase login                 # opens a browser
supabase link --project-ref zpuhlgjuoqrxcakeyhbg
supabase db pull               # writes the full schema as a new migration
```

`db pull` writes one migration containing the entire current schema: tables,
enum, views, functions, and every policy. Commit it.

```bash
git add supabase/migrations
git commit -m "Capture the live schema, including every RLS policy"
```

Then delete the warning at the top of `README.md`, which will no longer be
true.

## Check it worked

The new file should contain all of these. If any is missing, the pull was
partial and the gap is still open:

```bash
grep -c "create policy"      supabase/migrations/*_remote_schema.sql   # expect 25+
grep -c "create table"       supabase/migrations/*_remote_schema.sql   # expect 11+
grep    "security_invoker"   supabase/migrations/*_remote_schema.sql   # the views
grep    "app_role"           supabase/migrations/*_remote_schema.sql   # the enum
```

## What `db pull` does not capture

Worth knowing, because it is easy to assume the file is complete:

- **Storage buckets and their policies** (`rm-sheets`, `po-docs`). Record them
  by hand.
- **The pg_cron job** `auto_escalate_to_md`. It lives in the `cron` schema.
- **Auth configuration** — redirect URLs, SMTP, password policy, whether
  sign-ups are open. All dashboard settings, none of them in any migration.
- **Data.** This is schema only, which is correct — but it means a restore
  gives you an empty item master.

## Afterwards

Make the dashboard the exception rather than the habit. A policy changed in
the SQL editor and not written down as a migration puts you back where you
started, and the next person to read this repository will believe it is
current.
