from typing import Any, Callable, Sequence, Union

from supabase import create_client, Client
from supabase.client import ClientOptions

from app.config import get_settings

# Supabase caps a single REST read at 1000 rows. Anything that can exceed that
# — the item catalogue, a sheet's requirement lines — must be paged, or it comes
# back silently truncated.
PAGE_SIZE = 1000


def fetch_all(
    build_page: Callable[[], Any],
    order_by: Union[str, Sequence[str]],
) -> list[dict[str, Any]]:
    """Page through an entire result set.

    `build_page` returns a fresh PostgREST query each call (they are stateful,
    so one cannot be reused across pages).

    `order_by` must TOTALLY order the rows, and a column that merely looks like
    an identifier is not enough. Postgres makes no promise about the relative
    order of rows that tie, so with a non-unique sort the same row can appear on
    two pages while another appears on none — silently, and only once the data
    is big enough to need a second page.
    
    Several callers were ordering the reconciliation view by `item_code` and
    receipts by `grc_no`, neither of which is unique: one item has a row per lot
    and location, one GRC covers many lines. Pass every column needed to make
    the order unique — a sequence is applied in order.
    """
    keys = [order_by] if isinstance(order_by, str) else list(order_by)
    if not keys:
        raise ValueError("fetch_all needs at least one ordering column")

    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        q = build_page()
        for k in keys:
            q = q.order(k)
        res = q.range(start, start + PAGE_SIZE - 1).execute()
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
