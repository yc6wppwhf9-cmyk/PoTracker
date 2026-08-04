from supabase import create_client, Client
from supabase.client import ClientOptions

from app.config import get_settings


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
