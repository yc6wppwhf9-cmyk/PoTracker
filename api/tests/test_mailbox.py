from email.message import EmailMessage

from app.mailbox import (
    message_id,
    sender_address,
    should_process,
    spreadsheet_attachments,
)

ALLOWED = ["erp@hscvpl.in"]


def _mail(
    frm="ERP System <erp@hscvpl.in>",
    subject="GRC Register 05-08-2026",
    attachments=(("grn.xlsx", b"PK\x03\x04fake"),),
    msg_id="<abc123@hscvpl.in>",
):
    m = EmailMessage()
    m["From"] = frm
    m["Subject"] = subject
    if msg_id:
        m["Message-ID"] = msg_id
    m.set_content("Please find the register attached.")
    for name, data in attachments:
        m.add_attachment(
            data,
            maintype="application",
            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=name,
        )
    return m


def test_reads_the_sender_address():
    assert sender_address(_mail()) == "erp@hscvpl.in"


def test_finds_the_spreadsheet():
    got = spreadsheet_attachments(_mail())
    assert [n for n, _ in got] == ["grn.xlsx"]
    assert got[0][1] == b"PK\x03\x04fake"


def test_ignores_non_spreadsheet_attachments():
    """A signature image must not be mistaken for the register."""
    m = _mail(attachments=(("logo.png", b"\x89PNG"), ("grn.xlsx", b"PK\x03\x04")))
    assert [n for n, _ in spreadsheet_attachments(m)] == ["grn.xlsx"]


def test_accepts_a_matching_message():
    ok, why = should_process(_mail(), ALLOWED)
    assert ok, why


def test_rejects_an_unknown_sender():
    """The allowlist is the security boundary: anyone who learns the address
    could otherwise write into the goods-received record."""
    ok, why = should_process(_mail(frm="stranger@example.com"), ALLOWED)
    assert not ok
    assert "not allowed" in why


def test_allows_a_whole_domain_when_configured():
    ok, _ = should_process(_mail(frm="anyone@hscvpl.in"), ["hscvpl.in"])
    assert ok


def test_rejects_a_message_with_no_spreadsheet():
    ok, why = should_process(_mail(attachments=()), ALLOWED)
    assert not ok
    assert "no spreadsheet" in why


def test_subject_filter_is_applied_when_set():
    ok, why = should_process(_mail(subject="Holiday notice"), ALLOWED, "grc register")
    assert not ok
    assert "subject" in why

    ok, _ = should_process(_mail(subject="GRC Register 05-08-2026"), ALLOWED, "grc register")
    assert ok


def test_subject_matching_ignores_how_the_spaces_fall():
    """The real register arrives as "GRN  REPORT" — two spaces.

    A filter of "GRN REPORT" is what anyone would type, looks identical in
    every mail client, and matched nothing at all: twenty messages checked,
    the register skipped as "subject does not match".
    """
    ok, _ = should_process(_mail(subject="GRN  REPORT"), ALLOWED, "GRN REPORT")
    assert ok

    # And the reverse, in case the extra space is the one that was configured.
    ok, _ = should_process(_mail(subject="GRN REPORT"), ALLOWED, "GRN  REPORT")
    assert ok

    # Leading and trailing space, which survives a paste into a config form.
    ok, _ = should_process(_mail(subject="GRN  REPORT"), ALLOWED, "  grn report ")
    assert ok


def test_subject_filter_still_excludes_a_different_report():
    """Collapsing whitespace must not turn the filter into a wildcard."""
    ok, why = should_process(_mail(subject="Purchase Order(PO)"), ALLOWED, "GRN REPORT")
    assert not ok
    assert "subject" in why


def test_decodes_an_encoded_subject_and_sender():
    """Real mail headers are often RFC 2047 encoded."""
    m = _mail()
    del m["Subject"]
    m["Subject"] = "=?utf-8?B?R1JDIFJlZ2lzdGVy?="  # "GRC Register"
    ok, _ = should_process(m, ALLOWED, "grc register")
    assert ok


def test_message_id_identifies_a_message():
    assert message_id(_mail()) == "<abc123@hscvpl.in>"


def test_message_id_falls_back_when_absent():
    """Without an id a message would be reimported on every run."""
    mid = message_id(_mail(msg_id=None))
    assert mid
    assert "erp@hscvpl.in" in mid


def test_an_empty_allowlist_accepts_nothing():
    """Fail closed.

    This used to read `if senders and not any(...)`, so an unset or mistyped
    GRN_ALLOWED_SENDERS turned the only security control on this path into a
    no-op: anything with a spreadsheet attached became goods received. The
    imports looked normal, which is what made it dangerous.
    """
    ok, why = should_process(_mail(), [])
    assert not ok
    assert "GRN_ALLOWED_SENDERS" in why

    # Whitespace-only is the same mistake wearing a different hat.
    ok, _ = should_process(_mail(), ["  ", ""])
    assert not ok
