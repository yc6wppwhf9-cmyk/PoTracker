import os
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
    """
    raw = os.getenv(name, default).strip()
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
