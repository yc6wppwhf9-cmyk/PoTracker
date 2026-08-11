"""A ceiling on how often one caller can trigger expensive work.

On the API, not the edge, because that is where the cost is: parsing a
workbook, building an export, calling Claude, sending mail. Vercel never sees
these requests, and the cron endpoint is not reached through the web app at
all.

In process, deliberately. A shared counter in Postgres or Redis would be exact
across instances, and neither exists here — adding one to solve a problem
nobody has yet is the wrong order. With a single instance this is exact; with
several the effective limit multiplies by the instance count, which still
bounds the damage by a constant. If the service is ever scaled out properly,
this wants replacing rather than tuning.

Not a security boundary. It stops a stuck retry loop, an accidental
double-click on an import, and one bored authenticated user from spending the
Claude budget. It does not stop a determined attacker, and RLS is what protects
the data.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = Lock()

# Keys are per caller AND per bucket, so a slow export cannot use up somebody
# else's ability to upload.
def check(key: str, limit: int, per_seconds: int, what: str) -> None:
    """Record one use of `key`, or refuse if it is over the limit."""
    now = time.monotonic()
    cutoff = now - per_seconds

    with _lock:
        q = _hits[key]
        while q and q[0] < cutoff:
            q.popleft()

        if len(q) >= limit:
            # How long until the oldest use falls out of the window: a number
            # somebody can act on rather than "try again later".
            wait = int(q[0] + per_seconds - now) + 1
            raise HTTPException(
                429,
                f"Too many {what} requests — the limit is {limit} every "
                f"{per_seconds // 60 or 1} minute(s). Try again in {wait}s.",
                headers={"Retry-After": str(wait)},
            )

        q.append(now)

        # Keep the table from growing without bound on a long-lived process.
        if len(_hits) > 5000:
            for k in [k for k, v in _hits.items() if not v or v[-1] < cutoff]:
                _hits.pop(k, None)


def limit_uploads(user_id: str) -> None:
    """Parsing a workbook: seconds of CPU and tens of megabytes."""
    check(f"upload:{user_id}", limit=20, per_seconds=600, what="upload")


def limit_exports(user_id: str) -> None:
    """Building a workbook in memory, which is the same cost in reverse."""
    check(f"export:{user_id}", limit=20, per_seconds=600, what="export")


def limit_ai(user_id: str) -> None:
    """Claude calls cost real money per request, so this one is tightest."""
    check(f"ai:{user_id}", limit=10, per_seconds=600, what="AI summary")


def limit_notify(user_id: str) -> None:
    """Mail. A loop here spends the Resend quota and lands the domain in spam
    folders, which is far more expensive to undo than to prevent."""
    check(f"notify:{user_id}", limit=60, per_seconds=600, what="notification")


def limit_cron(caller: str = "cron") -> None:
    """The mailbox fetch. Generous — a five-minute schedule uses 12 an hour —
    but it caps a runaway scheduler or a leaked secret being hammered."""
    check(f"cron:{caller}", limit=60, per_seconds=3600, what="mailbox fetch")
