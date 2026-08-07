import os
import unicodedata
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def env(name: str, default: str = "") -> str:
    """Read an environment variable, tolerating a pasted `NAME=value` line.

    Render's form has separate Key and Value fields, and pasting the whole
    `APP_URL=https://…` line into Value is easy to do and hard to spot: the
    service starts, /health looks fine, and only the links inside notification
    emails are wrong — they become relative URLs and lead nowhere.

    Also strips surrounding quotes and whitespace, both of which survive a
    copy-paste and neither of which is ever meant literally.

    Invisible formatting characters (zero-width spaces, a BOM, directional
    marks) are removed outright. Copying a value out of a browser picks them up
    silently, and they are never part of anything anyone meant to configure.
    """
    raw = os.getenv(name, default)
    # Unicode category Cf — present in the text, absent from the screen.
    raw = "".join(c for c in raw if unicodedata.category(c) != "Cf").strip()
    if raw.startswith(f"{name}="):
        raw = raw[len(name) + 1 :].strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        raw = raw[1:-1].strip()
    return raw


class Settings:
    supabase_url: str = env("SUPABASE_URL")
    supabase_anon_key: str = env("SUPABASE_ANON_KEY")
    anthropic_api_key: str = env("ANTHROPIC_API_KEY")
    # Transactional email. Absent key => notifications are skipped, never fatal.
    resend_api_key: str = env("RESEND_API_KEY")
    resend_from: str = env("RESEND_FROM", "Procurement <onboarding@resend.dev>")
    # Used to build links inside notification emails. The trailing slash is
    # removed so app_url("/procurement/...") cannot produce a double slash.
    app_url: str = env("APP_URL", "http://localhost:3000").rstrip("/")
    # Testing: when set, every notification is redirected to this address
    # instead of its real recipients. Leave empty in production.
    notify_override_to: str = env("NOTIFY_OVERRIDE_TO")
    # --- Automated GRN fetch (Render Cron -> POST /grn/fetch-mail) ---
    # Shared secret the cron job presents. Without it the endpoint is closed:
    # it runs without a signed-in user, so nothing else identifies the caller.
    # All whitespace removed, not just the ends: a non-breaking space picked up
    # mid-value from a copy-paste is invisible in Render's form and a secret
    # never legitimately contains one.
    cron_secret: str = "".join(env("CRON_SECRET").split())
    # A Supabase account holding the po_team role. The job signs in as this
    # user so RLS still applies — deliberately not a service-role key, which
    # would bypass every policy in the database.
    service_email: str = env("SERVICE_ACCOUNT_EMAIL")
    service_password: str = env("SERVICE_ACCOUNT_PASSWORD")
    # Mailbox to read the register from.
    imap_host: str = env("IMAP_HOST", "imap.gmail.com")
    imap_user: str = env("IMAP_USER")
    # Google shows an app password as four groups of four for readability, and
    # it is invariably pasted that way. The gaps are presentation, not part of
    # the secret.
    #
    # split() rather than replace(" ", ""): what Google renders is a
    # NON-BREAKING space, and IMAP encodes the login as ASCII, so one survived
    # the obvious fix and failed as "'ascii' codec can't encode character
    # '\xa0'" — a message that names an encoding rather than the password it
    # came from.
    imap_password: str = "".join(env("IMAP_PASSWORD").split())
    imap_folder: str = env("IMAP_FOLDER", "INBOX")
    # Only mail from these addresses (or domains) is imported.
    grn_allowed_senders: list[str] = [
        a.strip() for a in env("GRN_ALLOWED_SENDERS").split(",") if a.strip()
    ]
    # Optional extra filter, e.g. "grc register".
    grn_subject_contains: str = env("GRN_SUBJECT_CONTAINS")

    allowed_origins: list[str] = [
        o.strip().rstrip("/")
        for o in env("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]

    def require(self) -> None:
        missing = [
            name
            for name in ("supabase_url", "supabase_anon_key")
            if not getattr(self, name)
        ]
        if missing:
            raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.require()
    return s
