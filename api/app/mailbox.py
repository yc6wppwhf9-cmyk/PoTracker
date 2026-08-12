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


def _quote(addr: str) -> str:
    """An address safe to put inside an IMAP quoted string."""
    return "".join(c for c in addr if c.isprintable() and c not in '"\\').strip()


def search_criteria(from_addresses: Iterable[str] = ()) -> str:
    """The IMAP SEARCH expression for "unread, and from someone we care about".

    Filtering at the server rather than in Python is not an optimisation, it is
    the difference between working and not. See fetch_unseen.

    Sender only — deliberately not subject. The real register's subject is
    "GRN  REPORT" with two spaces, and IMAP SEARCH compares substrings without
    normalising whitespace, so a server-side subject filter would reject the
    very message it was written to find. Python's should_process collapses the
    whitespace and can be trusted with that comparison; the server cannot.

    IMAP's OR is a prefix operator taking exactly two arguments, so a list of
    three becomes `OR a OR b c` rather than anything resembling a SQL IN.
    """
    terms = [f'FROM "{q}"' for q in (_quote(a) for a in from_addresses) if q]
    if not terms:
        return "UNSEEN"
    expr = terms[0]
    for t in terms[1:]:
        expr = f"OR {t} {expr}"
    return f"UNSEEN {expr}"


def fetch_unseen(
    host: str,
    user: str,
    password: str,
    folder: str = "INBOX",
    limit: int = 50,
    port: int = 993,
    from_addresses: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """Return up to `limit` unread messages from the given senders, OLDEST first.

    Messages are NOT marked read here. That happens only after a successful
    import, so a crash mid-import leaves the mail to be picked up next run
    rather than losing a delivery silently.

    `from_addresses` matters more than it looks. Two earlier decisions, each
    right on its own, combine badly without it:

      * this takes the OLDEST unread messages, so a backlog is worked through
        from the front rather than being stranded behind newer mail;
      * a message skipped by the sender or subject filter is left UNREAD, so
        that correcting the filter can still pick it up.

    Point both at a real mailbox with years of unread newsletters in it and the
    job jams solid. The oldest fifty are all newsletters, all skipped, all left
    unread — so the next run reads the same fifty, and the register sitting
    behind them is never reached. Not slowly: never. That is exactly what
    happened here, with the front of the queue held by Google My Business mail
    from 2020.

    Asking the server for the register's sender only means the backlog is not
    merely deprioritised, it is invisible, and `limit` applies to messages that
    could plausibly be a register rather than to the inbox at large.

    This is not the security boundary — should_process still decides, on the
    real headers, and IMAP's own FROM matching is a loose substring test not
    worth trusting. It is how the right messages get looked at at all.
    """
    conn = imaplib.IMAP4_SSL(host, port)
    try:
        conn.login(user, password)
        conn.select(folder)
        criteria = search_criteria(from_addresses)
        typ, data = conn.search(None, criteria)
        if typ != "OK" and criteria != "UNSEEN":
            # A server that dislikes the expression must not mean no imports at
            # all. Fall back to the plain search; the jam is better than silence
            # and should_process still guards what gets stored.
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
