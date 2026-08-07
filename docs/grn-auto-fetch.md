# Automatic GRN import from email

Every 5 minutes, a Render Cron Job asks the API to check a mailbox. Any unread
message from an approved sender carrying a spreadsheet is parsed as a GRN
register and imported.

Nothing about the parsing or matching differs from the manual upload — the file
just arrives by a different route.

## What you need to create

### 0. What the mail looks like

The register arrives from **Ginesys Reports `<admin@hscvpl.com>`**, subject
**GRN REPORT**, with one `.xlsx` attached (`GRn_Goods_Received…`), several times
a day. The two filters below are set from exactly that, so a different report
landing in the same mailbox is ignored rather than parsed as a register.

### 1. A Gmail App Password

The mailbox that receives the register needs an App Password; a normal account
password will not work for IMAP.

1. That Google account needs 2-Step Verification switched on.
2. <https://myaccount.google.com/apppasswords> → create one, name it `PoTracker`.
3. Copy the 16-character value. It is shown once.

Also confirm IMAP is enabled: Gmail → Settings → **Forwarding and POP/IMAP** →
*Enable IMAP*.

### 2. A service account in Supabase

The job runs on a schedule, so there is no signed-in user — but this codebase
has **no service-role key anywhere by design**: row-level security is the only
access boundary, and a service-role client would ignore every policy in the
database.

So the job signs in as an ordinary Supabase user instead, and is bound by the
same rules as a person doing the import by hand.

1. Supabase → Authentication → Users → **Add user**, e.g.
   `grn-bot@hscvpl.in`, with a long random password. Confirm the email.
2. In the SQL editor, give it the role that may import:

   ```sql
   update public.profiles
      set role = 'po_team', full_name = 'GRN import (automated)'
    where email = 'grn-bot@hscvpl.in';
   ```

   If no profile row exists for it, insert one with that id.

### 3. A shared secret

Any random string, e.g. `openssl rand -hex 32`. The cron job sends it as a
header; without it the endpoint refuses to run. It is the only thing
authenticating the caller.

## Environment variables (on the API service in Render)

| Variable | Example | Notes |
| --- | --- | --- |
| `CRON_SECRET` | `9f3c…` | Shared with the cron job below |
| `SERVICE_ACCOUNT_EMAIL` | `grn-bot@hscvpl.in` | The Supabase user above |
| `SERVICE_ACCOUNT_PASSWORD` | `…` | Its password |
| `IMAP_HOST` | `imap.gmail.com` | Default; no need to set for Gmail |
| `IMAP_USER` | `grn@hscvpl.in` | The mailbox receiving the register |
| `IMAP_PASSWORD` | 16-char App Password | **Not** the account password |
| `IMAP_FOLDER` | `INBOX` | Or a Gmail label the register is filtered into |
| `GRN_ALLOWED_SENDERS` | `admin@hscvpl.com` | The address Ginesys sends from. A bare domain works too |
| `GRN_SUBJECT_CONTAINS` | `grn report` | Matches the "GRN REPORT" subject, case-insensitive |

`GRN_ALLOWED_SENDERS` is a security control, not a convenience. Anyone who
learns the mailbox address could otherwise post a spreadsheet into your
goods-received record, which is what the approver's pending-PO list is judged
against. Leave it set.

## The cron job

Render → **New** → **Cron Job**, same repository:

- **Schedule**: `*/5 * * * *`
- **Command**:

  ```bash
  curl -fsS -X POST https://potracker.onrender.com/grn/fetch-mail \
       -H "X-Cron-Secret: $CRON_SECRET"
  ```

- Add `CRON_SECRET` to the cron job's own environment too — it is a separate
  service from the API and does not inherit its variables.

`-f` makes curl exit non-zero on an HTTP error, so a failing fetch shows as a
failed cron run rather than a green tick over an error body.

## Only UNREAD mail is collected

The job looks at unread messages only, so anything already opened by hand is
skipped — including the reports sitting in the mailbox now. To have those
imported, mark them unread first; otherwise collection begins with the next one
to arrive.

Reading is done with `BODY.PEEK`, which does not itself mark anything read, and
a message is only flagged once its contents are safely stored.

## What happens on each run

1. Unread messages are read with `BODY.PEEK`, which does not mark them read.
2. Messages already recorded in `grn_mail` are skipped. The mailbox's own read
   flag is not relied on alone — a person opening the mail would mark it read,
   and the register would then never be imported at all.
3. Sender and subject are checked, then every `.xlsx` attachment is parsed.
4. Receipt lines are stored, replacing any lines already held for the same GRC
   number.
5. Only after that does the message get marked read. A crash midway leaves it
   unread, so the next run retries rather than losing a delivery.

Every attempt — imported, skipped or failed — writes a row to `grn_mail`. A
scheduled task that stops silently is worse than one that never existed, so
"when did we last receive a register?" stays answerable.

## Checking it works

```sql
select processed_at, status, sender, subject, filename, lines, detail
from public.grn_mail
order by processed_at desc
limit 20;
```

To test without waiting, run the cron command by hand — it is safe to repeat.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `503 CRON_SECRET is not configured` | Variable missing on the **API** service |
| `401 Bad or missing X-Cron-Secret` | Cron job and API hold different values. Check `cron_secret_len` on `/health` — a correct secret is 64 characters |
| `502 Could not read the mailbox` | Wrong App Password, or IMAP disabled in Gmail |
| `checked: 0` forever | Mail is not unread, or lands in a different folder than `IMAP_FOLDER` |
| Rows say `skipped` | Sender not in `GRN_ALLOWED_SENDERS`, or subject filter too narrow |
| Rows say `failed` | The attachment did not parse — `detail` says why |
| Imported, but `unmatched_lines` is high | PO numbers were never captured from their documents |
