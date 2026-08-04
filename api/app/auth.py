from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException, status
from supabase import Client

from app.supabase_client import user_client

ROLES = {
    "uploader",
    "purchase_head",
    "buyer",
    "po_team",
    "approver",
    "md",
    "admin",
}


@dataclass
class CurrentUser:
    id: str
    email: Optional[str]
    role: Optional[str]
    token: str
    client: Client  # bound to this user's JWT; RLS applies

    def has_role(self, *roles: str) -> bool:
        return self.role == "admin" or self.role in roles


def get_current_user(authorization: str = Header(default="")) -> CurrentUser:
    """
    FastAPI dependency: validate the Supabase JWT from the Authorization header,
    resolve the user's app role, and return a client scoped to that user.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Empty bearer token.")

    client = user_client(token)

    try:
        resp = client.auth.get_user(token)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token.")

    if not resp or not resp.user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token.")

    user = resp.user

    # The user can always read their own profile (RLS profiles_select_self_or_admin).
    prof = (
        client.table("profiles")
        .select("role, email, full_name")
        .eq("id", user.id)
        .maybe_single()
        .execute()
    )
    role = prof.data["role"] if prof and prof.data else None

    return CurrentUser(
        id=user.id,
        email=user.email,
        role=role,
        token=token,
        client=client,
    )


def require_roles(user: CurrentUser, *roles: str) -> None:
    if not user.has_role(*roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires role: {', '.join(roles)} (you are {user.role}).",
        )
