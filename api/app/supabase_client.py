from typing import Any, Callable

from supabase import create_client, Client
from supabase.client import ClientOptions

from app.config import get_settings

# Supabase caps a single REST read at 1000 rows. Anything that can exceed that
# — the item catalogue, a sheet's requirement lines — must be paged, or it comes
# back silently truncated.
PAGE_SIZE = 1000


def fetch_all(build_page: Callable[[], Any], order_by: str) -> list[dict[str, Any]]:
    """Page through an entire result set.

    `build_page` returns a fresh PostgREST query each call (they are stateful,
    so one cannot be reused across pages). `order_by` must be a column that
    totally orders the rows — without it Postgres may return rows in a
    different order per page, making pagination skip and duplicate rows.
    """
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        res = (
            build_page()
            .order(order_by)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def anon_client() -> Client:
    """Client with the publishable/anon key only (no user context)."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_anon_key)


def user_client(access_token: str) -> Client:
    """
    Client that carries the caller's JWT on every request, so PostgREST and
    Storage evaluate RLS as that authenticated user. The anon key is still sent
    as `apikey`; the Authorization header elevates the request to the user.
    """
    s = get_settings()
    return create_client(
        s.supabase_url,
        s.supabase_anon_key,
        options=ClientOptions(
            headers={"Authorization": f"Bearer {access_token}"}
        ),
    )


def service_client() -> Client:
    """Client signed in as the background service account.

    Scheduled work has no signed-in user, but this codebase has no service-role
    key by design — RLS is the only access boundary, and a service-role client
    would ignore every policy. Instead a real Supabase account (holding the
    po_team role) is signed in here, so a cron-driven import is subject to
    exactly the same rules as the same action performed by hand.
    """
    s = get_settings()
    if not s.service_email or not s.service_password:
        raise RuntimeError(
            "SERVICE_ACCOUNT_EMAIL and SERVICE_ACCOUNT_PASSWORD must be set for "
            "scheduled work to authenticate."
        )
    client = create_client(s.supabase_url, s.supabase_anon_key)
    res = client.auth.sign_in_with_password(
        {"email": s.service_email, "password": s.service_password}
    )
    token = getattr(getattr(res, "session", None), "access_token", None)
    if not token:
        raise RuntimeError("Service account sign-in failed.")
    return user_client(token)
