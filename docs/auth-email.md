# Password-reset email: sender and template

Out of the box, Supabase sends the reset mail from its own shared address with
a generic template. Two problems, and the second is the one that bites:

1. It arrives from `noreply@mail.app.supabase.io` and says "Supabase". Nobody
   at HSCVPL recognises either, so the mail reads like phishing — which is
   exactly the reflex you want staff to have about links asking for passwords.
2. **The built-in sender is rate limited to a few messages per hour, across the
   whole project.** Fine while one person tests it; useless on the morning
   somebody rolls out accounts to a dozen buyers. The failures are silent to
   the person who clicked, who simply never receives anything.

Pointing Supabase at Resend fixes both. Resend already sends every other
notification this system produces, from the same verified domain.

## 1. Custom SMTP

Supabase → **Project Settings → Authentication → SMTP Settings** → enable
*Custom SMTP*:

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (the literal word, not an address) |
| Password | your Resend API key — the same `re_…` value as `RESEND_API_KEY` |
| Sender email | `potracker@hscvpl.in` |
| Sender name | `PoTracker` |

The sender must be on a domain **verified in Resend**. `hscvpl.in` already is,
which is why the notification emails work; an unverified domain is accepted by
this form and then rejected at send time.

Use the same sender name the rest of the system already uses. Staff should not
have to learn that "PoTracker" and something else are the same application.

## 2. Template

Supabase → **Authentication → Email Templates → Reset Password**.

Subject:

```
Reset your PoTracker password
```

Body — `{{ .ConfirmationURL }}` is substituted by Supabase and must be left
exactly as it is:

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 4px;font-size:18px">RM → PO Reconciliation</h2>
  <p style="margin:0 0 20px;font-size:13px;color:#666">High Spirit Commercial Ventures Pvt Ltd</p>

  <p>Somebody asked to reset the password for this account.</p>

  <p style="margin:24px 0">
    <a href="{{ .ConfirmationURL }}"
       style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
      Choose a new password
    </a>
  </p>

  <p style="font-size:13px;color:#666">
    This link expires in one hour and can be used once.
  </p>

  <p style="font-size:13px;color:#666">
    If you did not ask for this, ignore this email — your password has not
    changed. Tell your administrator if it keeps arriving.
  </p>
</div>
```

That last paragraph is not filler. An unexpected reset mail is the first sign
somebody is trying an account, and the person receiving it needs to know both
that they are safe and that it is worth mentioning.

## 3. Check it

Sign out, use **Forgot your password?**, and confirm the mail arrives from
`PoTracker <potracker@hscvpl.in>` and lands on `https://po.hscvpl.in`.

If it does not arrive, look at the Resend dashboard's Logs before anything
else — a rejected sender or a bounced address shows there, and Supabase's own
logs will only say the send failed.

## Also worth setting

Supabase → **Authentication → Policies**:

- **Leaked password protection** — checks new passwords against
  HaveIBeenPwned. It matters more now that an admin sets a starting password
  and the person is told to change it themselves.
- Minimum password length. The app requires 10 characters on the reset screen;
  setting the same here stops a shorter one being accepted by any other route.
