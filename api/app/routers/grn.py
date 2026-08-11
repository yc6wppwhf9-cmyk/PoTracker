"""Import the GRN (GRC) register and match it back to purchase orders."""

from __future__ import annotations

import hmac
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from app.uploads import read_upload
from app.ratelimit import limit_cron, limit_uploads
from app.auth import CurrentUser, get_current_user, require_roles
from app.config import get_settings
from app.grn_parsing import parse_grn_register
from app.mailbox import (
    _decode,
    fetch_unseen,
    mark_seen,
    message_id,
    sender_address,
    should_process,
    spreadsheet_attachments,
)
from app.supabase_client import fetch_all, service_client

log = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/grn", tags=["grn"])

ALLOWED_EXT = (".xlsx", ".xlsm", ".xls")

# Reading a spreadsheet costs several times the file size in memory. Beyond
# this the process risks being killed mid-request, and the client then sees the
# connection drop with no status — which reads as a network or CORS failure and
# says nothing about the real cause. Refusing with a message is the better
# failure.
#
# The parser merges rows as it reads rather than building a list and then
# deduplicating it, so a register of this size no longer holds two copies of
# itself. Raise this further only alongside a larger instance: the ceiling is
# the instance's memory, not the file.


@router.post("/import")
def import_grn_register(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Load a GRC register export.

    Re-importing is safe and is the expected way to load a corrected register:
    every GRC number present in the file has its existing lines replaced, so a
    quantity fixed at source overwrites rather than adds. GRC numbers absent
    from the file are left alone, so a monthly export does not erase history.
    """
    require_roles(user, "po_team", "purchase_head", "admin")

    filename = file.filename or "grn"
    if not filename.lower().endswith(ALLOWED_EXT):
        raise HTTPException(400, f"Allowed types: {', '.join(ALLOWED_EXT)}")

    limit_uploads(user.id)
    data = read_upload(file, "GRN register")

    try:
        parsed = parse_grn_register(data)
    except MemoryError:
        raise HTTPException(
            413,
            "The register was too large to parse. Export a shorter date range "
            "and import it in parts.",
        )
    except Exception as e:
        raise HTTPException(400, f"Could not read the register: {e}")

    if not parsed["header_found"]:
        raise HTTPException(
            400,
            "No recognisable header row was found. Expected columns including "
            "GRC NO., PO NO., BARCODE and QTY.",
        )

    rows: list[dict[str, Any]] = parsed["rows"]
    if not rows:
        return {
            "imported": 0,
            "reason": "The register contained no receipt lines with a positive quantity.",
            **{k: parsed[k] for k in ("parsed", "skipped_no_grc", "skipped_no_qty")},
        }

    # The workbook bytes are no longer needed and the instance is small.
    del data

    # Everything is stored; the register SCREENS show only what can be
    # reconciled, via the grn_ours view.
    #
    # Filtering on the way in was tried and reverted. It gave the same clean
    # screen but lost data: a receipt arriving before the PO team captured the
    # number off its document was dropped and never retried, because the next
    # register carries a GRC we then have no record of having seen — the
    # material would show as never delivered. Stored and filtered at read time,
    # a PO number captured late brings its receipts into view instead.
    matched = _match_summary(user, rows)
    inserted, grc_numbers = _store(user, rows)
    over = _over_receipts(user, rows)

    # No mail is sent for a receipt. An import matches hundreds of lines at
    # once, so a notification per import is either noise or a summary nobody
    # can act on without opening the register — which is where the pending,
    # complete and excess quantities are shown against the order.

    user.client.table("audit_log").insert(
        {
            "actor_id": user.id,
            "entity": "grn",
            "entity_id": None,
            "action": "grn_imported",
            "detail": {
                "filename": filename,
                "receipts": len(grc_numbers),
                "lines": inserted,
                **matched["counts"],
            },
        }
    ).execute()

    return {
        "imported": inserted,
        "receipts": len(grc_numbers),
        "merged_duplicate_lines": parsed["merged"],
        "skipped_no_grc": parsed["skipped_no_grc"],
        "skipped_no_qty": parsed["skipped_no_qty"],
        "over_received": over,
        **matched,
    }


def _match_summary(user: CurrentUser, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Report how much of the import could be tied to a known purchase order.

    An unmatched receipt is not an error — goods can arrive against a PO raised
    outside this system — but it is the number that says whether PO numbers are
    being captured properly, so it is reported rather than left to be noticed.
    """
    pos = fetch_all(
        lambda: user.client.table("po").select("id, po_number").not_.is_(
            "po_number", "null"
        ),
        order_by="id",
    )
    known = {str(p["po_number"]).upper() for p in pos if p.get("po_number")}

    with_po = [r for r in rows if r.get("po_number")]
    matched = [r for r in with_po if r["po_number"] in known]
    unmatched = [r for r in with_po if r["po_number"] not in known]
    no_number = [r for r in rows if not r.get("po_number")]

    # A handful of examples makes an unmatched batch diagnosable at a glance —
    # usually a PO number that was never captured from its document.
    examples = sorted({r["po_number"] for r in unmatched})[:5]

    return {
        "counts": {
            "matched_lines": len(matched),
            "unmatched_lines": len(unmatched),
            "lines_without_po_number": len(no_number),
        },
        "unmatched_po_numbers": examples,
    }


def _rows_for_known_pos(
    user: CurrentUser, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Keep only receipt lines whose PO number exists in this system.

    Used for REPORTING only — every line is stored regardless. The register
    screens read the grn_ours view, which applies the same rule at read time so
    a PO number captured after the delivery brings its receipts into view.

    A line with no PO number counts as not ours: without one it can never be
    tied to an order.
    """
    pos = fetch_all(
        lambda: user.client.table("po")
        .select("po_number")
        .not_.is_("po_number", "null"),
        order_by="id",
    )
    known = {
        str(p["po_number"]).strip().upper() for p in pos if p.get("po_number")
    }
    if not known:
        return []
    return [
        r
        for r in rows
        if r.get("po_number") and str(r["po_number"]).strip().upper() in known
    ]


def _store(user: Any, rows: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """Write receipt lines, replacing any existing lines for the same GRC.

    One transaction per batch, via replace_grn_rows.
    #
    This used to delete every row for the GRC numbers in the file and then
    insert the replacements in chunks. A failure between the two — a bad value,
    a dropped connection, the instance recycled mid-request — left those
    receipts deleted and the replacement partly written, with nothing reporting
    it. The register looked imported and the quantities the approver judges
    deliveries against were simply lower than reality.

    Batched by GRC rather than by row, so a batch is never split across two
    transactions: every line of a receipt is replaced together or not at all.
    """
    if not rows:
        return 0, []

    by_grc: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_grc.setdefault(r["grc_no"], []).append(r)

    grc_numbers = sorted(by_grc)
    inserted = 0

    # ~200 receipts at a time. The whole import has to finish inside one HTTP
    # request, and a single statement carrying a 145,000-row payload is its own
    # kind of fragile.
    for i in range(0, len(grc_numbers), 200):
        batch_grcs = grc_numbers[i : i + 200]
        batch_rows = [r for g in batch_grcs for r in by_grc[g]]
        payload = [_jsonable(r) for r in batch_rows]
        try:
            res = user.client.rpc(
                "replace_grn_rows",
                {"p_grc_numbers": batch_grcs, "p_rows": payload},
            ).execute()
            inserted += int(res.data or 0)
        except Exception as e:
            if not _missing_function(e):
                raise
            # Until 20260822_atomic_replace.sql is applied. Same behaviour as
            # before, including the window this function exists to close.
            log.warning(
                "replace_grn_rows() is missing — falling back to "
                "delete-then-insert. Apply supabase/migrations/"
                "20260822_atomic_replace.sql."
            )
            user.client.table("grn").delete().in_("grc_no", batch_grcs).execute()
            for j in range(0, len(batch_rows), 1000):
                chunk = [
                    {**r, "imported_by": user.id} for r in batch_rows[j : j + 1000]
                ]
                r2 = (
                    user.client.table("grn")
                    .insert(chunk, returning="minimal")
                    .execute()
                )
                inserted += len(r2.data or []) or len(chunk)

    return inserted, grc_numbers


def _jsonable(row: dict[str, Any]) -> dict[str, Any]:
    """A parsed row as JSON the function can read: dates as ISO strings."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, (date, datetime)):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


def _missing_function(e: Exception) -> bool:
    """True when the database has no such function (migration not applied)."""
    t = str(e)
    return "PGRST202" in t or "Could not find the function" in t


class _Acting:
    """Stand-in for CurrentUser so the shared helpers take the same shape when
    the work is done by the service account rather than a signed-in person."""

    def __init__(self, user_id, client):
        self.id = user_id
        self.client = client


def _log_mail(acting, mid, sender, subject, filename, status, detail, lines):
    """Record the attempt. Never raises: a logging failure must not lose an
    import that already succeeded."""
    try:
        acting.client.table("grn_mail").upsert(
            {
                "message_id": mid,
                "sender": sender,
                "subject": (subject or "")[:500],
                "filename": filename,
                "status": status,
                "detail": detail,
                "lines": lines,
                "processed_by": acting.id,
            },
            on_conflict="message_id",
        ).execute()
    except Exception:
        pass


@router.post("/fetch-mail")
def fetch_grn_from_mail(x_cron_secret: str = Header(default="")):
    """Import any GRN register that has arrived by email.

    Runs on a schedule, so there is no signed-in user: the shared secret
    authenticates the caller, and the work is then performed as the service
    account so RLS still applies exactly as it would for a person.

    Safe to call as often as you like. A message already recorded in grn_mail is
    skipped, and a register whose GRC numbers are already stored replaces them
    rather than adding — so a retry after a partial failure converges instead of
    double-counting.
    """
    settings = get_settings()
    if not settings.cron_secret:
        raise HTTPException(503, "CRON_SECRET is not configured on this service.")
    # compare_digest, not ==, so the comparison cannot be timed to recover the
    # secret a character at a time. This header is the only thing standing
    # between the open internet and writing into the goods-received record.
    #
    # Compared as bytes: given str arguments compare_digest raises TypeError on
    # anything outside ASCII, and a secret copied out of a browser can easily
    # carry a non-breaking space or zero-width character. That surfaced as a 500
    # on every run — an authentication problem wearing a server-error costume.
    if not hmac.compare_digest(
        x_cron_secret.encode("utf-8"), settings.cron_secret.encode("utf-8")
    ):
        raise HTTPException(401, "Bad or missing X-Cron-Secret header.")
    limit_cron()
    if not settings.imap_user or not settings.imap_password:
        raise HTTPException(503, "IMAP_USER and IMAP_PASSWORD are not configured.")

    try:
        messages = fetch_unseen(
            settings.imap_host,
            settings.imap_user,
            settings.imap_password,
            settings.imap_folder,
        )
    except Exception as e:
        raise HTTPException(502, f"Could not read the mailbox: {e}")

    if not messages:
        return {"checked": 0, "imported": 0, "results": []}

    client = service_client()
    who = client.auth.get_user()
    acting = _Acting(getattr(getattr(who, "user", None), "id", None), client)

    # Messages already handled. The mailbox read-flag alone is not enough: a
    # person opening the mail would mark it read and the register would then
    # never be imported at all.
    #
    # Only messages actually IMPORTED block a retry. A message skipped because
    # it did not match the sender or subject filter was skipped by
    # configuration, not by anything about the message — and correcting that
    # configuration has to be able to pick it up. The real register was lost
    # exactly this way: the subject filter said "GRN REPORT", the subject read
    # "GRN  REPORT", and the one message that mattered was consumed and
    # recorded as handled before the filter was fixed.
    ids = [message_id(m["msg"]) for m in messages]
    seen = (
        acting.client.table("grn_mail")
        .select("message_id, status")
        .in_("message_id", ids)
        .execute()
    ).data or []
    seen_ids = {r["message_id"] for r in seen if r.get("status") == "imported"}

    results: list[dict[str, Any]] = []
    imported_total = 0
    done_uids: list[str] = []

    for entry in messages:
        msg = entry["msg"]
        mid = message_id(msg)
        subject = _decode(msg.get("Subject"))
        frm = sender_address(msg)

        if mid in seen_ids:
            results.append({"message": subject, "status": "already imported"})
            continue

        ok, why = should_process(
            msg, settings.grn_allowed_senders, settings.grn_subject_contains
        )
        if not ok:
            # Recorded, but deliberately NOT marked read. Someone else's mail
            # is not ours to touch, and leaving the flag alone is what lets a
            # corrected filter find the message on the next run. Re-reading a
            # handful of headers every five minutes costs nothing.
            _log_mail(acting, mid, frm, subject, None, "skipped", why, 0)
            results.append({"message": subject, "status": "skipped", "detail": why})
            continue

        failed = False
        for filename, data in spreadsheet_attachments(msg):
            try:
                parsed = parse_grn_register(data)
                if not parsed["header_found"]:
                    raise ValueError(
                        "no recognisable header row (expected GRC NO., PO NO., "
                        "BARCODE, QTY)"
                    )
                rows = parsed["rows"]
                inserted = _store(acting, rows)[0] if rows else 0
                # How much of it is ours is recorded alongside, because
                # "imported 900 lines" and "imported 900, 4 of them against
                # our POs" are different situations and only one is worth a
                # look. Nothing is discarded either way.
                ours = len(_rows_for_known_pos(acting, rows)) if rows else 0
                _log_mail(
                    acting,
                    mid,
                    frm,
                    subject,
                    filename,
                    "imported",
                    f"{ours} of {inserted} line(s) match a PO raised here",
                    inserted,
                )
                imported_total += inserted
                results.append(
                    {
                        "message": subject,
                        "file": filename,
                        "status": "imported",
                        "lines": inserted,
                        "lines_for_our_pos": ours,
                    }
                )
            except Exception as e:
                # Deliberately left unread so the next run retries rather than
                # losing the delivery.
                _log_mail(acting, mid, frm, subject, filename, "failed", str(e)[:500], 0)
                results.append(
                    {
                        "message": subject,
                        "file": filename,
                        "status": "failed",
                        "detail": str(e)[:300],
                    }
                )
                failed = True
                break

        if not failed:
            done_uids.append(entry["uid"])

    if done_uids:
        try:
            mark_seen(
                settings.imap_host,
                settings.imap_user,
                settings.imap_password,
                done_uids,
                settings.imap_folder,
            )
        except Exception:
            # Not fatal: grn_mail already records the message, so it is
            # recognised and skipped next run even if the flag never got set.
            pass

    return {"checked": len(messages), "imported": imported_total, "results": results}


def _over_receipts(user: Any, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Lines where more has now arrived than the PO ordered.

    Reported at import because this is the moment it becomes true, and the
    person importing is the one who can query the invoice. Waiting for someone
    to open the approver dashboard means the first sight of it is often after
    the invoice has been passed for payment.

    Only the PO numbers in this file are examined — a full sweep would re-report
    every historic excess on every import.
    """
    po_numbers = sorted({r["po_number"] for r in rows if r.get("po_number")})
    if not po_numbers:
        return {"lines": 0, "examples": []}

    ordered: dict[tuple[str, str, str], float] = {}
    for i in range(0, len(po_numbers), 100):
        chunk = po_numbers[i : i + 100]
        pos = (
            user.client.table("po")
            .select("po_number, po_line(item_code, lot, ordered_qty)")
            .in_("po_number", chunk)
            .neq("status", "draft")
            .execute()
        ).data or []
        for p in pos:
            for line in p.get("po_line") or []:
                if not line.get("item_code"):
                    continue
                # Keyed on PO number and item only: the register names lots
                # differently from the RM sheet, so including the lot meant a
                # receipt never matched its order.
                key = (
                    str(p["po_number"]).upper(),
                    str(line["item_code"]).upper(),
                )
                ordered[key] = ordered.get(key, 0.0) + float(line.get("ordered_qty") or 0)

    if not ordered:
        return {"lines": 0, "examples": []}

    # Received is summed from the stored table, not from this file: an earlier
    # delivery against the same line counts towards the excess.
    received: dict[tuple[str, str, str], float] = {}
    for i in range(0, len(po_numbers), 100):
        chunk = po_numbers[i : i + 100]
        got = fetch_all(
            lambda c=chunk: user.client.table("grn")
            .select("po_number, item_code, lot, qty")
            .in_("po_number", c),
            order_by="id",
        )
        for g in got:
            if not g.get("item_code"):
                continue
            key = (
                str(g["po_number"]).upper(),
                str(g["item_code"]).upper(),
            )
            received[key] = received.get(key, 0.0) + float(g.get("qty") or 0)

    # 2% matches the dashboard: deliveries are rarely exact, and flagging every
    # rounding difference would train people to ignore the list.
    examples = []
    count = 0
    for key, qty in received.items():
        want = ordered.get(key)
        if not want or want <= 0:
            continue
        if qty > want * 1.02:
            count += 1
            if len(examples) < 5:
                examples.append(
                    {
                        "po_number": key[0],
                        "item_code": key[1],
                        "ordered": want,
                        "received": qty,
                        "excess": round(qty - want, 3),
                    }
                )

    return {"lines": count, "examples": examples}
