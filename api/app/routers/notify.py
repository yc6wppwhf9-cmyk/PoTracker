"""Transactional email.

The Resend key lives here rather than in the Next.js app so all third-party
secrets sit behind one backend.

Each endpoint sends one *named* notification and resolves its own recipients
and body from the database. Deliberately not a generic send-email endpoint: one
that accepted arbitrary addresses and HTML would be an open relay for anyone
holding a staff login, letting them send whatever they liked from the company's
sending domain.
"""
from __future__ import annotations

import html
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_roles
from app.config import get_settings

router = APIRouter(prefix="/notify", tags=["notify"])

RESEND_URL = "https://api.resend.com/emails"


def _app_url(path: str) -> str:
    base = get_settings().app_url.rstrip("/")
    return f"{base}{path}"


def _send(to: list[str], subject: str, body_html: str) -> dict[str, Any]:
    """Deliver via Resend, degrading gracefully.

    A missing key or no recipients must never break the workflow that triggered
    the notification — the approval itself already succeeded by this point.
    """
    settings = get_settings()
    recipients = [t for t in to if t]
    if not settings.resend_api_key or not recipients:
        return {
            "sent": False,
            "skipped": True,
            "reason": "no API key" if not settings.resend_api_key else "no recipients",
            "recipients": len(recipients),
        }

    try:
        res = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.resend_from,
                "to": recipients,
                "subject": subject[:200],
                "html": body_html,
            },
            timeout=15,
        )
    except Exception as e:
        print(f"[notify error] {e}")
        return {"sent": False, "error": str(e)}

    if res.status_code >= 300:
        print(f"[notify failed] {res.status_code} {res.text[:300]}")
        return {"sent": False, "status": res.status_code}
    return {"sent": True, "recipients": len(recipients)}


def _emails_with_role(user: CurrentUser, role: str) -> list[str]:
    res = user.client.table("profiles").select("email").eq("role", role).execute()
    return [r["email"] for r in (res.data or []) if r.get("email")]


def _email_of(user: CurrentUser, user_id: str) -> Optional[str]:
    res = (
        user.client.table("profiles")
        .select("email")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    return (res.data or [{}])[0].get("email")


def _sheet(user: CurrentUser, sheet_id: str) -> dict[str, Any]:
    res = (
        user.client.table("rm_sheet")
        .select("id, style_ref, uploaded_by")
        .eq("id", sheet_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "RM sheet not found.")
    return res.data[0]


class MdApproval(BaseModel):
    rm_sheet_id: str
    summary: str = ""


@router.post("/md-approval")
def notify_md_approval(
    payload: MdApproval, user: CurrentUser = Depends(get_current_user)
):
    """Approver sent a package to the MD."""
    require_roles(user, "approver")
    sheet = _sheet(user, payload.rm_sheet_id)
    ref = html.escape(sheet.get("style_ref") or payload.rm_sheet_id[:8])
    body = (
        f"<p>A reconciled PO for <strong>{ref}</strong> is awaiting your decision.</p>"
        f"<p><strong>Summary:</strong> {html.escape(payload.summary)}</p>"
        f'<p><a href="{_app_url("/procurement/md")}">Open the MD dashboard</a></p>'
    )
    return _send(_emails_with_role(user, "md"), "PO ready for your approval", body)


class BuyerEscalation(BaseModel):
    rm_sheet_id: str
    buyer_id: str
    item_code: str
    lot: Optional[str] = None
    reason: Optional[str] = None
    sla_hours: int = 9


@router.post("/buyer-escalation")
def notify_buyer_escalation(
    payload: BuyerEscalation, user: CurrentUser = Depends(get_current_user)
):
    """Approver escalated a flagged material to its assigned buyer."""
    require_roles(user, "approver")
    _sheet(user, payload.rm_sheet_id)  # 404 if the sheet is not visible

    to = _email_of(user, payload.buyer_id)
    code = html.escape(payload.item_code)
    lot = f" / {html.escape(payload.lot)}" if payload.lot else ""
    reason = (
        f"<p>Reason: {html.escape(payload.reason)}</p>" if payload.reason else ""
    )
    body = (
        f"<p>An approver escalated <strong>{code}</strong>{lot} to you.</p>{reason}"
        f"<p>Please resolve within {payload.sla_hours} working hours, or it "
        "auto-escalates to the MD.</p>"
        f'<p><a href="{_app_url("/procurement/buyer")}">Open your workspace</a></p>'
    )
    subject = f"Action needed: {payload.item_code}"
    if payload.lot:
        subject += f" ({payload.lot})"
    return _send([to] if to else [], subject, body)


class MdDecision(BaseModel):
    rm_sheet_id: str
    decision: str


@router.post("/md-decision")
def notify_md_decision(
    payload: MdDecision, user: CurrentUser = Depends(get_current_user)
):
    """MD approved or rejected — tell the uploader and the purchase head(s)."""
    require_roles(user, "md")
    if payload.decision not in ("approved", "rejected"):
        raise HTTPException(400, "decision must be 'approved' or 'rejected'.")

    sheet = _sheet(user, payload.rm_sheet_id)
    ref = html.escape(sheet.get("style_ref") or "the sheet")

    recipients: set[str] = set(_emails_with_role(user, "purchase_head"))
    if sheet.get("uploaded_by"):
        uploader = _email_of(user, sheet["uploaded_by"])
        if uploader:
            recipients.add(uploader)

    body = (
        f"<p>The Managing Director <strong>{html.escape(payload.decision)}</strong> "
        f"the PO for {ref}.</p>"
        f'<p><a href="{_app_url("/dashboard")}">Open the app</a></p>'
    )
    return _send(sorted(recipients), f"MD {payload.decision} — {ref}", body)
