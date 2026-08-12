from email.message import EmailMessage

from app.mailbox import (
    _identify,
    matches_headers,
    search_criteria,
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


# ─── The server-side search ────────────────────────────────────────────────
#
# The job jammed for a day on a mailbox holding years of unread Google
# newsletters: it reads the OLDEST unread mail first, and leaves anything it
# skips unread so a corrected filter can still find it. The oldest fifty were
# all newsletters, all skipped, all left unread — so every run re-read the same
# fifty and the register behind them was never reached. Asking the server for
# the register's sender is what makes the backlog invisible.


def test_search_asks_the_server_for_the_sender():
    assert search_criteria(["admin@hscvpl.com"]) == 'UNSEEN FROM "admin@hscvpl.com"'


def test_search_with_no_senders_is_plain_unseen():
    # should_process refuses everything in this case anyway; the search must
    # still be a valid expression rather than a syntax error.
    assert search_criteria([]) == "UNSEEN"


def test_or_is_a_prefix_operator_taking_two_arguments():
    """IMAP's OR is not SQL's IN, and getting it wrong returns nothing at all —
    silently, which is how this class of bug survives."""
    two = search_criteria(["a@x.com", "b@y.com"])
    assert two == 'UNSEEN OR FROM "b@y.com" FROM "a@x.com"'

    three = search_criteria(["a@x.com", "b@y.com", "c@z.com"])
    # One OR per additional term, each binding two arguments.
    assert three.count("OR ") == 2
    for a in ("a@x.com", "b@y.com", "c@z.com"):
        assert f'FROM "{a}"' in three


def test_a_quote_in_an_address_cannot_break_out_of_the_search():
    crit = search_criteria(['bad"@x.com', "ok@y.com"])
    assert crit.count('"') == 4  # two quoted strings, nothing loose
    assert 'FROM "bad@x.com"' in crit


def test_the_subject_is_deliberately_not_in_the_server_search():
    """The real subject is "GRN  REPORT" with two spaces. IMAP compares
    substrings without collapsing whitespace, so a server-side subject filter
    would reject the one message it exists to find."""
    assert "SUBJECT" not in search_criteria(["admin@hscvpl.com"])


# ─── The window must hold unjudged mail ────────────────────────────────────


class _FakeIMAP:
    """Just enough IMAP to exercise the selection logic."""

    def __init__(self, messages):
        # {sequence number: EmailMessage}
        self.messages = messages
        self.fetched_bodies = []

    def search(self, charset, criteria):
        return "OK", [b" ".join(k.encode() for k in self.messages)]

    def fetch(self, ids, spec):
        wanted = ids.decode().split(",") if isinstance(ids, bytes) else [ids]
        out = []
        for n in wanted:
            # A real server simply returns fewer items for ids it cannot serve.
            msg = self.messages.get(n)
            if msg is None:
                continue
            if "HEADER.FIELDS" not in spec:
                self.fetched_bodies.append(n)
            out.append((f"{n} (".encode(), msg.as_bytes()))
        return "OK", out


def _register(n):
    m = EmailMessage()
    m["Message-ID"] = f"<{n}@hscvpl.com>"
    m["From"] = "admin@hscvpl.com"
    m["Subject"] = f"message {n}"
    return m


def test_rejected_mail_does_not_fill_the_window():
    """The jam, twice over.

    Skipped mail is left unread on purpose so a corrected filter can find it.
    But the fetch takes the oldest N matches, so mail that is never accepted and
    never marked read accumulates in front of everything else: first fifty
    Google newsletters, then fifty purchase order emails from the ERP itself.
    Each run re-read the same fifty and a register behind them was unreachable.
    """
    msgs = {str(i): _register(i) for i in range(1, 8)}
    conn = _FakeIMAP(msgs)

    # The first five have already been turned down by this exact filter.
    judged = {f"<{i}@hscvpl.com>" for i in range(1, 6)}

    ids = [k.encode() for k in msgs]
    found = _identify(conn, ids)
    remaining = [i for i in ids if found.get(i.decode()) not in judged]

    # With a window of two, the naive order would return messages 1 and 2 —
    # both already rejected — and never reach 6 and 7.
    assert [i.decode() for i in remaining[:2]] == ["6", "7"]


def test_a_message_whose_headers_are_unreadable_is_still_examined():
    """Unknown means unjudged. The expensive mistake is dropping a register."""
    found = _identify(_FakeIMAP({"1": _register(1)}), [b"1", b"2"])
    assert found["1"] == "<1@hscvpl.com>"
    assert "2" not in found

    # Which is what matters: with no identity it cannot be matched against the
    # rejected set, so it survives the filter and gets looked at.
    judged = {"<1@hscvpl.com>"}
    kept = [i for i in (b"1", b"2") if found.get(i.decode()) not in judged]
    assert kept == [b"2"]


def test_headers_alone_decide_most_rejections():
    """The header checks must not need the body, or the body gets downloaded
    just to reject it — fifty nine-attachment registers per run on a small
    instance, to discard most of them."""
    no_attachment = EmailMessage()
    no_attachment["From"] = "erp@hscvpl.in"
    no_attachment["Subject"] = "GRN REPORT"

    ok, _ = matches_headers(no_attachment, ALLOWED, "GRN REPORT")
    assert ok  # headers alone cannot know, and must not guess

    # The whole-message check is the one that requires a spreadsheet.
    ok, why = should_process(no_attachment, ALLOWED, "GRN REPORT")
    assert not ok and why == "no spreadsheet attached"


def test_the_header_check_is_not_weaker_than_the_full_one():
    """Anything should_process accepts, matches_headers must also accept —
    otherwise a register is dropped before its body is ever fetched."""
    real = _mail(subject="GRN REPORT")  # right sender, subject and attachment
    assert should_process(real, ALLOWED, "GRN REPORT")[0]
    assert matches_headers(real, ALLOWED, "GRN REPORT")[0]

    wrong_sender = _mail(frm="someone@else.com", subject="GRN REPORT")
    assert not matches_headers(wrong_sender, ALLOWED, "GRN REPORT")[0]
    assert not should_process(wrong_sender, ALLOWED, "GRN REPORT")[0]
