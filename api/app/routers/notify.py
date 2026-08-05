"""Transactional email.

The Resend key lives here rather than in the Next.js app so all third-party
secrets sit behind one backend.

Each notification is *named*: it resolves its own recipients and body from the
database. Deliberately not a generic send-email endpoint — one that accepted
arbitrary addresses and HTML would be an open relay for anyone holding a staff
login, able to send whatever they liked from the company's sending domain.

Notifications follow the workflow handoffs, so each role is told when the work
reaches them:

    uploader uploads sheet   -> purchase head
    purchase head assigns    -> each assigned buyer (their own items only)
    buyer drafts a PO        -> PO team
    PO document attached     -> approver
    approver escalates       -> the assigned buyer
    escalation breaches SLA  -> MD
    MD decides               -> purchase head + uploader

The MD is mailed for escalations only. Sending them every approval package
would make the alert routine, and the point of an escalation is that it is not.
"""
from __future__ import annotations

import html
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.auth import CurrentUser, get_current_user, require_roles
from app.config import get_settings
from app.supabase_client import fetch_all

router = APIRouter(prefix="/notify", tags=["notify"])

RESEND_URL = "https://api.resend.com/emails"


def app_url(path: str) -> str:
    return f"{get_settings().app_url.rstrip('/')}{path}"


def send_email(to: list[str], subject: str, body_html: str) -> dict[str, Any]:
    """Deliver via Resend, degrading gracefully.

    A missing key or no recipients must never break the workflow that triggered
    the notification — that work has already been committed by this point.
    """
    settings = get_settings()
    recipients = [t for t in to if t]
    if not settings.resend_api_key or not recipients:
        return {
            "sent": False,
            "skipped": True,
            "reason": (
                "RESEND_API_KEY is not set on the API service, so no mail can "
                "be sent."
                if not settings.resend_api_key
                else "No email address was found for any intended recipient — "
                "check that those users have an email on their profile."
            ),
            "recipients": len(recipients),
        }

    # Testing override: send everything to one address instead of the real
    # recipients, so exercising the workflow cannot email actual staff.
    intended = recipients
    override = settings.notify_override_to.strip()
    if override:
        recipients = [override]
        subject = f"[TEST → {override}] {subject}"
        body_html = (
            '<div style="background:#fef3c7;border:1px solid #f59e0b;padding:12px;'
            'margin-bottom:16px;font-family:sans-serif;font-size:13px;color:#78350f">'
            "<strong>Test mode.</strong> This message was redirected here. "
            f"In production it would have gone to: {html.escape(', '.join(intended))}"
            "</div>"
        ) + body_html

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
        result = {"sent": False, "status": res.status_code, "detail": res.text[:300]}
        # A 403 naming the domain is not a code fault and not a DNS fault
        # either, most often: an API key belongs to one Resend team, and the
        # verified domain to another, which fails exactly like an unverified
        # domain. Say so, because the Resend message does not.
        if res.status_code == 403 and "domain is not verified" in res.text:
            sender = settings.resend_from
            result["hint"] = (
                f"Resend rejected the sender {sender}. Check, in order: the "
                "domain shows Verified (not Pending) at resend.com/domains; "
                "the API key in RESEND_API_KEY was created in the SAME Resend "
                "team as that domain; and RESEND_FROM uses that exact domain. "
                "To send before the domain is ready, set RESEND_FROM to "
                "'onboarding@resend.dev', which delivers only to the address "
                "that owns the Resend account."
            )
            print(f"[notify hint] {result['hint']}")
        return result

    result: dict[str, Any] = {"sent": True, "recipients": len(recipients)}
    if override:
        result["redirected_to"] = override
        result["intended"] = intended
    return result


def emails_with_role(client: Client, role: str) -> list[str]:
    res = client.table("profiles").select("email").eq("role", role).execute()
    return [r["email"] for r in (res.data or []) if r.get("email")]


def email_of(client: Client, user_id: str) -> Optional[str]:
    res = (
        client.table("profiles").select("email").eq("id", user_id).limit(1).execute()
    )
    return (res.data or [{}])[0].get("email")


def get_sheet(client: Client, sheet_id: str) -> dict[str, Any]:
    res = (
        client.table("rm_sheet")
        .select("id, style_ref, uploaded_by")
        .eq("id", sheet_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "RM sheet not found.")
    return res.data[0]


def _ref(sheet: dict[str, Any]) -> str:
    return html.escape(sheet.get("style_ref") or str(sheet.get("id", ""))[:8])


def _button(href: str, label: str) -> str:
    return f'<p><a href="{href}">{label}</a></p>'


# --------------------------------------------------------------------------
# 1. Uploader uploaded a sheet -> purchase head
# --------------------------------------------------------------------------
def notify_sheet_uploaded(
    client: Client, sheet_id: str, lines: int, distinct_items: int
) -> dict[str, Any]:
    sheet = get_sheet(client, sheet_id)
    ref = _ref(sheet)
    body = (
        f"<p>A new RM requirement sheet <strong>{ref}</strong> has been uploaded "
        "and is ready for buyer assignment.</p>"
        f"<p>{lines:,} requirement line(s) across {distinct_items:,} item(s).</p>"
        + _button(app_url(f"/procurement/assign/{sheet_id}"), "Assign buyers")
    )
    return send_email(
        emails_with_role(client, "purchase_head"),
        f"RM sheet ready for assignment — {sheet.get('style_ref') or sheet_id[:8]}",
        body,
    )


# --------------------------------------------------------------------------
# 4. PO document attached -> approver
# --------------------------------------------------------------------------
def notify_po_attached(client: Client, po_id: str) -> dict[str, Any]:
    po = (
        client.table("po")
        .select("id, rm_sheet_id")
        .eq("id", po_id)
        .limit(1)
        .execute()
    )
    if not po.data:
        return {"sent": False, "skipped": True, "reason": "PO not found"}
    sheet_id = po.data[0]["rm_sheet_id"]
    sheet = get_sheet(client, sheet_id)
    ref = _ref(sheet)
    body = (
        f"<p>A purchase order document has been attached for <strong>{ref}</strong>.</p>"
        "<p>The reconciliation is ready for your review.</p>"
        + _button(
            app_url(f"/procurement/reconciliation/{sheet_id}"),
            "Review reconciliation",
        )
    )
    return send_email(
        emails_with_role(client, "approver"),
        f"PO attached — ready for review ({sheet.get('style_ref') or sheet_id[:8]})",
        body,
    )


# --------------------------------------------------------------------------
# HTTP endpoints (called from Next.js server actions)
# --------------------------------------------------------------------------
class SheetOnly(BaseModel):
    rm_sheet_id: str


@router.post("/buyers-assigned")
def notify_buyers_assigned(
    payload: SheetOnly, user: CurrentUser = Depends(get_current_user)
):
    """Purchase head assigned buyers — tell each buyer about their own items.

    Assignments are read from the database rather than taken from the request,
    so a buyer can only ever be told about work actually assigned to them.
    """
    require_roles(user, "purchase_head")
    sheet = get_sheet(user.client, payload.rm_sheet_id)
    ref = _ref(sheet)

    rows = fetch_all(
        lambda: user.client.table("rm_requirement")
        .select("assigned_buyer")
        .eq("rm_sheet_id", payload.rm_sheet_id)
        .not_.is_("assigned_buyer", "null"),
        order_by="id",
    )
    per_buyer = Counter(r["assigned_buyer"] for r in rows if r.get("assigned_buyer"))
    if not per_buyer:
        return {"sent": False, "skipped": True, "reason": "no assignments"}

    results = []
    for buyer_id, count in per_buyer.items():
        to = email_of(user.client, buyer_id)
        body = (
            f"<p>You have been assigned <strong>{count:,} line(s)</strong> on RM "
            f"sheet <strong>{ref}</strong>.</p>"
            "<p>Review the items, set the supplier, rate and MOQ, then raise your "
            "PO drafts.</p>"
            + _button(
                app_url(f"/procurement/buyer/{payload.rm_sheet_id}"),
                "Open your workspace",
            )
        )
        results.append(
            send_email(
                [to] if to else [],
                f"{count} item(s) assigned to you — {sheet.get('style_ref') or ''}".strip(),
                body,
            )
        )
    return {"buyers": len(per_buyer), "results": results}


class PoDrafted(BaseModel):
    po_id: str


@router.post("/po-drafted")
def notify_po_drafted(
    payload: PoDrafted, user: CurrentUser = Depends(get_current_user)
):
    """Buyer raised a PO draft — tell the PO team to prepare the document."""
    require_roles(user, "buyer")
    po = (
        user.client.table("po")
        .select("id, rm_sheet_id")
        .eq("id", payload.po_id)
        .limit(1)
        .execute()
    )
    if not po.data:
        raise HTTPException(404, "PO not found.")
    sheet_id = po.data[0]["rm_sheet_id"]
    sheet = get_sheet(user.client, sheet_id)
    ref = _ref(sheet)

    lines = (
        user.client.table("po_line")
        .select("ordered_qty")
        .eq("po_id", payload.po_id)
        .execute()
    ).data or []
    total = sum(float(l.get("ordered_qty") or 0) for l in lines)

    body = (
        f"<p>A buyer has drafted a purchase order on <strong>{ref}</strong>.</p>"
        f"<p>{len(lines):,} line(s), {total:,.0f} total quantity.</p>"
        "<p>Confirm the quantities against the signed PO, then attach the "
        "document.</p>"
        + _button(app_url(f"/procurement/po-team/{sheet_id}"), "Open PO team")
    )
    return send_email(
        emails_with_role(user.client, "po_team"),
        f"New PO draft to process — {sheet.get('style_ref') or sheet_id[:8]}",
        body,
    )


@router.post("/md-escalations")
def notify_md_escalations(user: CurrentUser = Depends(get_current_user)):
    """Tell the MD about items escalated to them.

    The MD is mailed for escalations only — not for every approval package —
    so the alert means something when it arrives.

    Promotion is done by the pg_cron job `auto_escalate_to_md`, which runs
    every 15 minutes. That job can only flip the status: pg_net is not
    installed on this project, so nothing in the database can make an outbound
    HTTP call, and the mail has to originate here.

    The promotion below therefore duplicates the job deliberately rather than
    replacing it. It costs one indexed UPDATE, it is idempotent, and it means
    an escalation raised minutes ago is already visible to the MD when this
    runs instead of waiting for the next quarter-hour tick — and that the path
    still works if the job is ever paused or dropped.

    It is idempotent: escalation ids already mailed are recorded in audit_log
    and never mailed twice.
    """
    require_roles(user, "approver", "md", "purchase_head")

    # Promote anything past its deadline that the buyer has not resolved.
    # `resolved` rows are excluded by the status filter, so a buyer who
    # answered in time is never escalated.
    now = datetime.now(timezone.utc).isoformat()
    user.client.table("escalation").update(
        {"status": "md_escalated", "escalated_to_md_at": now}
    ).eq("status", "open").lte("escalate_after", now).execute()

    open_rows = (
        user.client.table("escalation")
        .select("id, item_code, lot, reason, escalate_after, rm_sheet_id")
        .eq("status", "md_escalated")
        .execute()
    ).data or []
    if not open_rows:
        return {"sent": False, "skipped": True, "reason": "nothing escalated"}

    already: set[str] = set()
    prior = (
        user.client.table("audit_log")
        .select("detail")
        .eq("entity", "escalation")
        .eq("action", "md_escalation_notified")
        .execute()
    ).data or []
    for row in prior:
        for eid in (row.get("detail") or {}).get("escalation_ids", []):
            already.add(eid)

    fresh = [r for r in open_rows if r["id"] not in already]
    if not fresh:
        return {"sent": False, "skipped": True, "reason": "already notified"}

    items = "".join(
        "<li><strong>{code}</strong>{lot} — overdue since {due}{why}</li>".format(
            code=html.escape(r.get("item_code") or "—"),
            lot=f" / {html.escape(r['lot'])}" if r.get("lot") else "",
            due=html.escape(str(r.get("escalate_after") or "")[:16]),
            why=f" — {html.escape(r['reason'])}" if r.get("reason") else "",
        )
        for r in fresh
    )
    body = (
        f"<p><strong>{len(fresh)}</strong> escalation(s) passed the "
        "9-working-hour SLA without being resolved by the buyer and have been "
        "escalated to you.</p>"
        f"<ul>{items}</ul>"
        + _button(app_url("/procurement/md"), "Open the MD dashboard")
    )
    result = send_email(
        emails_with_role(user.client, "md"),
        f"{len(fresh)} escalation(s) need your attention",
        body,
    )

    if result.get("sent"):
        user.client.table("audit_log").insert(
            {
                "actor_id": user.id,
                "entity": "escalation",
                "action": "md_escalation_notified",
                "detail": {"escalation_ids": [r["id"] for r in fresh]},
            }
        ).execute()
    return {**result, "escalations": len(fresh)}


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
    get_sheet(user.client, payload.rm_sheet_id)  # 404 if not visible

    to = email_of(user.client, payload.buyer_id)
    code = html.escape(payload.item_code)
    lot = f" / {html.escape(payload.lot)}" if payload.lot else ""
    reason = f"<p>Reason: {html.escape(payload.reason)}</p>" if payload.reason else ""
    body = (
        f"<p>An approver escalated <strong>{code}</strong>{lot} to you.</p>{reason}"
        f"<p>Please resolve within {payload.sla_hours} working hours, or it "
        "auto-escalates to the MD.</p>"
        + _button(app_url("/procurement/buyer"), "Open your workspace")
    )
    subject = f"Action needed: {payload.item_code}"
    if payload.lot:
        subject += f" ({payload.lot})"
    return send_email([to] if to else [], subject, body)


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

    sheet = get_sheet(user.client, payload.rm_sheet_id)
    ref = _ref(sheet)

    recipients: set[str] = set(emails_with_role(user.client, "purchase_head"))
    if sheet.get("uploaded_by"):
        uploader = email_of(user.client, sheet["uploaded_by"])
        if uploader:
            recipients.add(uploader)

    body = (
        f"<p>The Managing Director <strong>{html.escape(payload.decision)}</strong> "
        f"the PO for {ref}.</p>" + _button(app_url("/dashboard"), "Open the app")
    )
    return send_email(sorted(recipients), f"MD {payload.decision} — {ref}", body)
