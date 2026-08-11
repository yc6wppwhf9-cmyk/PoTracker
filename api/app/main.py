import logging
import os
import traceback
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers import (
    admin_users,
    ai,
    exports,
    grn,
    item_master,
    notify,
    pos,
    rm_sheets,
)

log = logging.getLogger("uvicorn.error")

settings = get_settings()

app = FastAPI(
    title="RM → PO Reconciliation API",
    version="0.1.0",
    description="Heavy backend: file parsing, quantity comparison, and Claude calls.",
)


# ORDER MATTERS. Starlette applies middleware outermost-last-added, and its own
# error handler sits outside everything — so an unhandled exception returns a
# 500 that never passes back through CORSMiddleware. The browser then sees a
# response with no Access-Control-Allow-Origin and reports a CORS failure,
# hiding the actual error completely. Catching exceptions here, INSIDE the CORS
# layer added below, means a genuine 500 still carries CORS headers and the
# real message reaches the developer console.
@app.middleware("http")
async def surface_errors_with_cors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        # Every unhandled error gets an id. The id goes to the client, the
        # exception goes to the log, and the two are joined by searching for it.
        #
        # The message itself used to be returned verbatim. That was deliberate
        # — CORS was swallowing 500s and the real cause was invisible — but a
        # raw Postgres error names tables, columns and constraints, which is
        # free reconnaissance for anyone poking at the API. The trade was right
        # while this was being built and wrong now that it is in use by people
        # who are not us.
        error_id = uuid.uuid4().hex[:12]
        detail = str(e) or e.__class__.__name__
        log.error(
            "Unhandled error %s on %s %s: %s",
            error_id,
            request.method,
            request.url.path,
            detail,
        )
        log.error(traceback.format_exc())

        # The one exception, because it is ours and not an attacker's business:
        # a missing table is nearly always an unapplied migration, and the
        # person seeing it is an administrator who can act on it.
        hint = None
        if "does not exist" in detail and "relation" in detail:
            hint = (
                "A table this endpoint needs is missing — apply the outstanding "
                "migrations in supabase/migrations, then retry."
            )

        return JSONResponse(
            status_code=500,
            content={
                "detail": (
                    "Something went wrong on the server. Quote reference "
                    f"{error_id} when reporting it."
                ),
                "error_id": error_id,
                "hint": hint,
            },
        )


# Added last, so it wraps the handler above and every response — including the
# error responses it produces.
#
# The preview-deployment regex is opt-in via ALLOW_VERCEL_PREVIEWS. It used to
# be unconditional, and `https://.*\.vercel\.app` trusts every Vercel account
# on the internet, not only this one — anybody can deploy there and get a
# matching origin. With a real domain configured that allowance buys nothing,
# so it is off unless somebody asks for it while testing a preview build.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=(
        r"https://[a-z0-9-]+\.vercel\.app" if settings.allow_vercel_previews else None
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rm_sheets.router)
app.include_router(item_master.router)
app.include_router(pos.router)
app.include_router(ai.router)
app.include_router(exports.router)
app.include_router(notify.router)
app.include_router(grn.router)
app.include_router(admin_users.router)


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    """Render's default health check sends `HEAD /`, which otherwise logs a 404
    on every ping. HEAD is listed explicitly: a plain @app.get would answer it
    with 405, which is quieter but still an error. Points at the endpoint that
    reports real health."""
    return {
        "service": "RM → PO Reconciliation API",
        "status": "ok",
        "health": "/health",
        "docs": "/docs",
    }


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    """Liveness plus enough configuration to diagnose a silent deployment.

    Mail is skipped rather than failed when RESEND_API_KEY is unset, and the
    Claude summary behaves the same way, so a misconfigured deploy looks
    healthy while quietly doing nothing. These flags make that visible.

    Deliberately booleans: no key, and no recipient address, is echoed back —
    this endpoint is unauthenticated.
    """
    s = get_settings()
    out = {
        "status": "ok",
        # Which commit is actually serving. Render sets RENDER_GIT_COMMIT on
        # every deploy; without it there is no way to tell a deployed fix from
        # one still building, which turns "is it live yet?" into guesswork.
        "commit": (os.getenv("RENDER_GIT_COMMIT") or "unknown")[:7],
        "email_configured": bool(s.resend_api_key),
        "email_from": s.resend_from,
        "test_mode_redirect": bool(s.notify_override_to),
        "anthropic_configured": bool(s.anthropic_api_key),
        # Whether an admin can create a login from the app. Boolean only.
        "user_creation_configured": bool(s.supabase_service_role_key),
        "app_url": s.app_url,
        # Not secret, and the cause of every "blocked by CORS" report: the
        # browser names the origin it sent, and this is the list it is
        # checked against.
        "allowed_origins": s.allowed_origins,
        "vercel_previews_allowed": s.allow_vercel_previews,
        # Whether the scheduled GRN fetch can run at all. Booleans only: this
        # endpoint is unauthenticated, and the point is to answer "is it set
        # up?" without anyone pasting a secret somewhere to find out.
        "grn_fetch": {
            "ready": all(
                [
                    s.cron_secret,
                    s.imap_user,
                    s.imap_password,
                    s.service_email,
                    s.service_password,
                ]
            ),
            "cron_secret": bool(s.cron_secret),
            # Length only, never the value. Enough to tell a correctly pasted
            # 64-character secret from a placeholder or a truncated paste,
            # which is otherwise only discoverable by a failing cron run.
            "cron_secret_len": len(s.cron_secret),
            "imap_user": bool(s.imap_user),
            "imap_password": bool(s.imap_password),
            "service_account": bool(s.service_email and s.service_password),
            "mailbox": s.imap_host,
            "folder": s.imap_folder,
            # Not a secret, and the commonest thing to get wrong — a sender
            # that does not match means every message is skipped.
            "allowed_senders": s.grn_allowed_senders,
            "subject_filter": s.grn_subject_contains or None,
        },
    }
    # Every link in every notification email is built from app_url. If it is
    # not absolute the links are silently unusable, and nothing else fails —
    # so it is called out here rather than left to be discovered by a
    # recipient clicking one.
    if not s.app_url.startswith(("http://", "https://")):
        out["warning"] = (
            f"APP_URL is not an absolute URL ({s.app_url!r}), so links in "
            "notification emails will not work. Set it to e.g. "
            "https://your-app.vercel.app"
        )
    return out
