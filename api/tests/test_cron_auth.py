"""The scheduled GRN fetch must accept the right secret and refuse every other.

A secret pasted into a hosting form is copied from somewhere — a terminal, a
browser, a chat window — and arrives carrying whatever invisible characters
came with it. `hmac.compare_digest` refuses non-ASCII `str` arguments outright,
so a single non-breaking space turned every scheduled run into a 500 that read
like a server fault rather than a mistyped variable.

The comparison itself stays constant-time; these tests only fix which values it
accepts.
"""

import importlib

import app.config
import app.routers.grn as grn_router
from app.config import env

SECRET = "6b7f57090268f8a90501298b507c895e373f19a6fa753561938b150ca95bf656"


class _Settings:
    """Only what the secret check reads, so nothing touches a mailbox."""

    def __init__(self, cron_secret: str):
        self.cron_secret = cron_secret
        self.imap_user = ""
        self.imap_password = ""


def _check(stored: str, presented: str):
    """Run the endpoint's authentication and report how far it got.

    Returns the HTTPException status and detail. A status of 503 about IMAP
    means the secret was accepted — the deliberately empty mailbox settings
    then stop it before any network call.
    """
    original = grn_router.get_settings
    grn_router.get_settings = lambda: _Settings(stored)
    try:
        grn_router.fetch_grn_from_mail(x_cron_secret=presented)
    except Exception as e:
        return getattr(e, "status_code", None), str(getattr(e, "detail", e))
    finally:
        grn_router.get_settings = original
    return None, ""


def test_correct_secret_is_accepted():
    status, detail = _check(SECRET, SECRET)
    assert status == 503
    assert "IMAP_USER" in detail


def test_wrong_secret_is_refused():
    assert _check(SECRET, "x" * 64)[0] == 401


def test_missing_header_is_refused():
    assert _check(SECRET, "")[0] == 401


def test_unset_secret_closes_the_endpoint():
    """No secret configured must not mean no secret required."""
    assert _check("", "")[0] == 503
    assert _check("", "anything")[0] == 503


def test_non_ascii_secret_does_not_crash():
    """The actual bug: a 500 where a 401 belonged."""
    assert _check(SECRET + " ", SECRET)[0] == 401


def test_non_ascii_header_does_not_crash():
    """The same, arriving from the caller's side instead."""
    assert _check(SECRET, "sécret")[0] == 401


def _configured_secret(monkeypatch, value: str) -> str:
    """The secret Settings ends up holding for a given environment value.

    Reloaded, because Settings reads the environment when the class is defined
    rather than when it is instantiated — the process picks up its
    configuration once at start-up, and setting a variable afterwards changes
    nothing.
    """
    monkeypatch.setenv("CRON_SECRET", value)
    return importlib.reload(app.config).Settings().cron_secret


def test_invisible_characters_are_stripped_from_the_configured_secret(monkeypatch):
    """Characters that survive a copy-paste and show up nowhere on screen.

    Removing them means the value a person believes they configured is the
    value that authenticates, rather than one that silently never matches.
    """
    # A BOM, a zero-width space mid-value, a trailing non-breaking space.
    messy = "﻿" + SECRET[:8] + "​" + SECRET[8:] + " "
    assert _configured_secret(monkeypatch, messy) == SECRET


def test_a_pasted_key_equals_value_line_is_still_understood(monkeypatch):
    assert _configured_secret(monkeypatch, f"CRON_SECRET={SECRET}") == SECRET


def test_gmail_app_password_loses_its_display_gaps(monkeypatch):
    """Google renders the 16 characters as four groups, using NON-BREAKING
    spaces. IMAP encodes the login as ASCII and rejects one outright, so the
    obvious replace(" ", "") left the password looking correct and still
    failing -- as "'ascii' codec can't encode character '\xa0'", a message
    that names an encoding rather than the password it came from."""
    shown = " ".join(["wqtg", "lxyo", "cehx", "glup"])
    monkeypatch.setenv("IMAP_PASSWORD", shown)
    assert importlib.reload(app.config).Settings().imap_password == "wqtglxyocehxglup"


def test_app_password_with_ordinary_spaces_also_works(monkeypatch):
    monkeypatch.setenv("IMAP_PASSWORD", "wqtg lxyo cehx glup")
    assert importlib.reload(app.config).Settings().imap_password == "wqtglxyocehxglup"


def test_ordinary_values_are_untouched(monkeypatch):
    """The stripping must not damage a value that was always fine."""
    monkeypatch.setenv("RESEND_FROM", "PoTracker <potracker@hscvpl.in>")
    assert env("RESEND_FROM") == "PoTracker <potracker@hscvpl.in>"
