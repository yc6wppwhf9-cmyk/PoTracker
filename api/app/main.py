from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import ai, exports, item_master, notify, pos, rm_sheets

settings = get_settings()

app = FastAPI(
    title="RM → PO Reconciliation API",
    version="0.1.0",
    description="Heavy backend: file parsing, quantity comparison, and Claude calls.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
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
        "email_configured": bool(s.resend_api_key),
        "email_from": s.resend_from,
        "test_mode_redirect": bool(s.notify_override_to),
        "anthropic_configured": bool(s.anthropic_api_key),
        "app_url": s.app_url,
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
