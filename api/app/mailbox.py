"""Read GRN register attachments out of a mailbox over IMAP.

The register arrives by email; this fetches it so nobody has to upload it.

The message-handling is deliberately split from the IMAP transport: everything
that decides *which* mail counts and *what* to pull out of it is a pure function
over a raw message, so it can be tested without a mail server.
"""

from __future__ import annotations

import email
import imaplib
import re
from email.header import decode_header, make_header
from email.message import Message
from typing import Any, Iterable

SPREADSHEET_EXT = (".xlsx", ".xlsm", ".xls")


def _decode(value: str | None) -> str:
    """Decode an RFC 2047 header (=?utf-8?B?…?=) to plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def sender_address(msg: Message) -> str:
    """The bare address from the From header, lowercased."""
    raw = _decode(msg.get("From"))
    m = re.search(r"<([^>]+)>", raw)
    return (m.group(1) if m else raw).strip().lower()


def spreadsheet_attachments(msg: Message) -> list[tuple[str, bytes]]:
    """Every spreadsheet attached to a message, as (filename, bytes).

    Inline images and signatures are ignored by extension rather than by
    Content-Disposition: mail clients disagree about what counts as an
    attachment, but nobody sends a .xlsx by accident.
    """
    out: list[tuple[str, bytes]] = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        name = _decode(part.get_filename())
        if not name or not name.lower().endswith(SPREADSHEET_EXT):
            continue
        try:
            payload = part.get_payload(decode=True)
        except Exception:
            continue
        if payload:
            out.append((name, payload))
    return out


def _squash(s: str) -> str:
    """Lower-cased, with every run of whitespace reduced to one space."""
    return " ".join(s.split()).lower()


def should_process(
    msg: Message,
    allowed_senders: Iterable[str],
    subject_contains: str = "",
) -> tuple[bool, str]:
    """Decide whether a message is a GRN register. Returns (yes, why not).

    The sender allowlist is the security boundary. Anyone who learns the address
    could otherwise post a spreadsheet into the goods-received record, which
    feeds what the approver believes has been delivered.
    """
    senders = [s.strip().lower() for s in allowed_senders if s.strip()]
    frm = sender_address(msg)

    # No allowlist means NOTHING is accepted, not everything.
    #
    # This read `if senders and not any(...)`, so an unset or mistyped
    # GRN_ALLOWED_SENDERS quietly turned the one security control on this path
    # into a no-op: any message reaching the mailbox with a spreadsheet
    # attached would be imported as goods received. That is the record the
    # approver judges deliveries against, and the failure is silent — the
    # imports look normal. Refusing everything is loud and harmless by
    # comparison; the fix is to set the variable.
    if not senders:
        return False, (
            "no allowed senders are configured (GRN_ALLOWED_SENDERS is empty), "
            "so nothing is imported"
        )
    if not any(frm == s or frm.endswith("@" + s.lstrip("@")) for s in senders):
        return False, f"sender {frm or '(unknown)'} is not allowed"

    if subject_contains:
        # Whitespace collapsed on both sides before comparing. The real subject
        # is "GRN  REPORT" with two spaces, and a filter of "GRN REPORT"
        # therefore matched nothing while looking exactly right — the gap is
        # invisible in every mail client and in Render's form alike. Line
        # breaks folded into long subjects by the mail transport are the same
        # problem arriving a different way.
        subject = _squash(_decode(msg.get("Subject")))
        if _squash(subject_contains) not in subject:
            return False, "subject does not match"

    if not spreadsheet_attachments(msg):
        return False, "no spreadsheet attached"

    return True, ""


def message_id(msg: Message) -> str:
    """Stable identity for a message, for not importing one twice.

    Falls back to a composite when Message-ID is absent, which is rare but not
    impossible — without it a message would be reprocessed on every run.
    """
    mid = _decode(msg.get("Message-ID")).strip()
    if mid:
        return mid
    return "|".join(
        [
            _decode(msg.get("Date")),
            sender_address(msg),
            _decode(msg.get("Subject")),
        ]
    )


def fetch_unseen(
    host: str,
    user: str,
    password: str,
    folder: str = "INBOX",
    limit: int = 50,
    port: int = 993,
) -> list[dict[str, Any]]:
    """Return up to `limit` unread messages, OLDEST first.

    Messages are NOT marked read here. That happens only after a successful
    import, so a crash mid-import leaves the mail to be picked up next run
    rather than losing a delivery silently.
    """
    conn = imaplib.IMAP4_SSL(host, port)
    try:
        conn.login(user, password)
        conn.select(folder)
        typ, data = conn.search(None, "UNSEEN")
        if typ != "OK":
            return []
        # OLDEST first. This took the newest `limit`, so once more than that
        # many unread messages accumulated, the older ones were never reached
        # again — each run looked at the same recent batch and the backlog sat
        # there permanently. A register that arrives while the job is failing
        # is exactly the one that must not be skipped.
        ids = (data[0] or b"").split()[:limit]

        out: list[dict[str, Any]] = []
        for num in ids:
            # BODY.PEEK avoids setting \Seen just by looking.
            typ, payload = conn.fetch(num, "(BODY.PEEK[])")
            if typ != "OK" or not payload or not payload[0]:
                continue
            raw = payload[0][1]
            if not isinstance(raw, (bytes, bytearray)):
                continue
            msg = email.message_from_bytes(bytes(raw))
            out.append({"uid": num.decode(), "msg": msg})
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            conn.logout()
        except Exception:
            pass


def mark_seen(host: str, user: str, password: str, uids: list[str],
              folder: str = "INBOX", port: int = 993) -> None:
    """Mark messages read, once their contents are safely stored."""
    if not uids:
        return
    conn = imaplib.IMAP4_SSL(host, port)
    try:
        conn.login(user, password)
        conn.select(folder)
        for uid in uids:
            try:
                conn.store(uid, "+FLAGS", "\\Seen")
            except Exception:
                continue
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            conn.logout()
        except Exception:
            pass
