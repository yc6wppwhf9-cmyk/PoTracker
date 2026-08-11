"""An unhandled error must still reach the browser as an error.

Starlette's own 500 handler sits outside the middleware stack, so an exception
escaping a route produced a response with no Access-Control-Allow-Origin. The
browser then reported a CORS failure and discarded the body — turning every
server error into the same misleading message, with the real cause visible only
in the server log.

That is how "relation public.grn does not exist" reached a user as
"blocked by CORS policy".
"""

from fastapi.testclient import TestClient

from app.main import app

from app.config import get_settings

# The app's own origin, taken from configuration rather than hard-coded: the
# wildcard *.vercel.app allowance is now opt-in, so a literal preview URL would
# be refused here and the test would be asserting the wrong thing.
ORIGIN = get_settings().allowed_origins[0]


@app.get("/__test_boom")
def _boom():
    raise RuntimeError('relation "public.grn" does not exist')


@app.get("/__test_fine")
def _fine():
    return {"ok": True}


client = TestClient(app, raise_server_exceptions=False)


def test_error_response_carries_cors_headers():
    r = client.get("/__test_boom", headers={"Origin": ORIGIN})
    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_error_response_does_not_leak_the_exception():
    """The message named tables, columns and constraints.

    Returning it verbatim was deliberate once — CORS was swallowing 500s and
    the cause was invisible — but it hands anyone probing the API a free map of
    the schema. The client now gets a reference; the exception goes to the log,
    and the two are joined by searching for that reference.
    """
    r = client.get("/__test_boom", headers={"Origin": ORIGIN})
    body = r.json()
    assert "public.grn" not in body["detail"]
    assert "does not exist" not in body["detail"]
    assert body["error_id"] and body["error_id"] in body["detail"]


def test_missing_table_is_explained_as_a_migration():
    """The commonest cause, and the one a Postgres message does not name."""
    r = client.get("/__test_boom", headers={"Origin": ORIGIN})
    assert "migrations" in (r.json()["hint"] or "")


def test_successful_responses_still_carry_cors_headers():
    r = client.get("/__test_fine", headers={"Origin": ORIGIN})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_preflight_is_answered():
    r = client.options(
        "/grn/import",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_an_unlisted_origin_is_refused():
    """The point of dropping the *.vercel.app wildcard.

    That regex matched every Vercel account on the internet, not only this
    one — anybody can deploy there and get an origin that satisfies it.
    """
    r = client.get(
        "/__test_fine", headers={"Origin": "https://someone-elses-app.vercel.app"}
    )
    assert r.headers.get("access-control-allow-origin") is None
