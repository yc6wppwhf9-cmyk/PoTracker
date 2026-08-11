"""The limiter must refuse, recover, and keep callers apart."""

import time

import pytest
from fastapi import HTTPException

from app import ratelimit


@pytest.fixture(autouse=True)
def _clean():
    ratelimit._hits.clear()
    yield
    ratelimit._hits.clear()


def test_allows_up_to_the_limit_then_refuses():
    for _ in range(3):
        ratelimit.check("k", limit=3, per_seconds=60, what="test")
    with pytest.raises(HTTPException) as e:
        ratelimit.check("k", limit=3, per_seconds=60, what="test")
    assert e.value.status_code == 429


def test_says_how_long_to_wait():
    """"Try again later" is not actionable; a number is, and a client can act
    on Retry-After without a person reading anything."""
    ratelimit.check("k", limit=1, per_seconds=60, what="test")
    with pytest.raises(HTTPException) as e:
        ratelimit.check("k", limit=1, per_seconds=60, what="test")
    assert "Retry-After" in e.value.headers
    assert int(e.value.headers["Retry-After"]) > 0


def test_one_caller_cannot_exhaust_another():
    """Per key, so a buyer running imports cannot lock out the PO team."""
    for _ in range(2):
        ratelimit.check("user-a", limit=2, per_seconds=60, what="test")
    ratelimit.check("user-b", limit=2, per_seconds=60, what="test")


def test_buckets_are_independent():
    """Uploads and exports are separately budgeted, so a slow export cannot
    consume the ability to upload."""
    ratelimit.limit_ai("u1")
    for _ in range(20):
        ratelimit.limit_uploads("u1")  # its own, larger allowance


def test_the_window_slides():
    ratelimit.check("k", limit=1, per_seconds=1, what="test")
    with pytest.raises(HTTPException):
        ratelimit.check("k", limit=1, per_seconds=1, what="test")
    time.sleep(1.05)
    ratelimit.check("k", limit=1, per_seconds=1, what="test")


def test_the_table_does_not_grow_without_bound():
    """A long-lived process must not accumulate a row per caller forever."""
    for i in range(6000):
        ratelimit.check(f"u{i}", limit=1, per_seconds=1, what="test")
    assert len(ratelimit._hits) <= 6000
