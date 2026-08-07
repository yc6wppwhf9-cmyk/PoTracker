"""Creating a login, which is the one thing RLS cannot do for us.

Everything else in this codebase reaches the database as the signed-in person,
with row-level security as the only access boundary and no elevated key
anywhere. Creating an auth user is the exception: GoTrue has no policy system,
so the only ways to add an account are the admin API (service-role key) or
public sign-up, and public sign-up would let anyone with the publishable key
create one.

So the key exists, and these are the limits on it:

  * It lives on this service only. Never in the browser, never in the web app's
    environment, never in a client bundle.
  * It is used for exactly one call — creating the auth user. The profile row,
    including the role, is written with the CALLER's client, so RLS still
    decides whether that person may set a role at all.
  * Every endpoint here requires a signed-in admin. The key is not an
    alternative route in; it is what the admin's own request is carried out
    with, after their identity has been checked.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import ROLES, CurrentUser, get_current_user, require_roles
from app.config import get_settings

router = APIRouter(prefix="/admin", tags=["admin"])


class NewUser(BaseModel):
    # Plain str, not pydantic's EmailStr: that pulls in email-validator, and a
    # new runtime dependency for one field is a poor trade when GoTrue
    # validates the address anyway and returns a clear message.
    email: str = Field(min_length=3, max_length=254)
    # 8, matching the reset screen. A starting password the admin types and
    # passes on, not a lasting one.
    password: str = Field(min_length=8, max_length=200)
    full_name: str = ""
    role: str = "uploader"


@router.post("/users")
def create_user(payload: NewUser, user: CurrentUser = Depends(get_current_user)):
    """Create a login and give it a role.

    The account is created already confirmed. An invite mail would be tidier,
    but it depends on SMTP being configured in Supabase and on the person
    acting on it — and an admin sitting with a new joiner wants them able to
    sign in now. They should change the password immediately; the forgot-
    password flow is there for that.
    """
    require_roles(user, "admin")

    settings = get_settings()
    if not settings.supabase_service_role_key:
        raise HTTPException(
            503,
            "SUPABASE_SERVICE_ROLE_KEY is not set on the API service, so "
            "accounts cannot be created from the app. Add it in Render "
            "(Supabase → Project Settings → API → service_role), or create the "
            "user in the Supabase dashboard instead.",
        )

    role = payload.role.strip().lower()
    if role not in ROLES:
        raise HTTPException(400, f"Unknown role: {payload.role}")

    email = str(payload.email).strip().lower()
    if "@" not in email or " " in email:
        raise HTTPException(400, f"That does not look like an email address: {email}")

    # 1. The auth user. The only call the elevated key is used for.
    try:
        res = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json={
                "email": email,
                "password": payload.password,
                "email_confirm": True,
                "user_metadata": {"full_name": payload.full_name.strip()},
            },
            timeout=30,
        )
    except Exception as e:
        raise HTTPException(502, f"Could not reach the auth service: {e}")

    if res.status_code >= 400:
        detail = _explain(res)
        raise HTTPException(res.status_code if res.status_code < 500 else 502, detail)

    new_id: Optional[str] = (res.json() or {}).get("id")
    if not new_id:
        raise HTTPException(502, "The auth service did not return a user id.")

    # 2. The profile, as the ADMIN — not with the elevated key. If their own
    #    permission to set roles is ever narrowed, this narrows with it.
    #
    #    A trigger may already have inserted the row on creation, so this is an
    #    upsert rather than an insert.
    try:
        user.client.table("profiles").upsert(
            {
                "id": new_id,
                "email": email,
                "full_name": payload.full_name.strip() or None,
                "role": role,
            },
            on_conflict="id",
        ).execute()
    except Exception as e:
        # The login exists but has no role. Say so plainly: it is fixable from
        # the same screen, and silence would leave an account nobody can place.
        raise HTTPException(
            500,
            f"The account was created, but its role could not be set ({e}). "
            "Set it from the Users list.",
        )

    try:
        user.client.table("audit_log").insert(
            {
                "actor_id": user.id,
                "entity": "profiles",
                "entity_id": new_id,
                "action": "user_created",
                "detail": {"email": email, "role": role},
            }
        ).execute()
    except Exception:
        pass

    return {"id": new_id, "email": email, "role": role}


def _explain(res: httpx.Response) -> str:
    """GoTrue's own message, or something better where it is unhelpful."""
    try:
        body = res.json()
        msg = body.get("msg") or body.get("message") or body.get("error_description")
    except Exception:
        msg = res.text[:200]

    low = (msg or "").lower()
    if "already been registered" in low or "already exists" in low:
        return (
            "An account with that email already exists. Change its role from "
            "the list below rather than creating a second one."
        )
    if res.status_code in (401, 403):
        return (
            "The auth service refused the key. SUPABASE_SERVICE_ROLE_KEY is "
            "wrong, or belongs to a different project than SUPABASE_URL."
        )
    return msg or f"The auth service returned HTTP {res.status_code}."
