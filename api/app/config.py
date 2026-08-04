import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Transactional email. Absent key => notifications are skipped, never fatal.
    resend_api_key: str = os.getenv("RESEND_API_KEY", "")
    resend_from: str = os.getenv(
        "RESEND_FROM", "Procurement <onboarding@resend.dev>"
    )
    # Used to build links inside notification emails.
    app_url: str = os.getenv("APP_URL", "http://localhost:3000")
    # Testing: when set, every notification is redirected to this address
    # instead of its real recipients. Leave empty in production.
    notify_override_to: str = os.getenv("NOTIFY_OVERRIDE_TO", "")
    allowed_origins: list[str] = [
        o.strip()
        for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
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
