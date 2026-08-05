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


@app.get("/health")
def health():
    """Liveness plus enough configuration to diagnose a silent deployment.

    Mail is skipped rather than failed when RESEND_API_KEY is unset, and the
    Claude summary behaves the same way, so a misconfigured deploy looks
    healthy while quietly doing nothing. These flags make that visible.

    Deliberately booleans: no key, and no recipient address, is echoed back —
    this endpoint is unauthenticated.
    """
    s = get_settings()
    return {
        "status": "ok",
        "email_configured": bool(s.resend_api_key),
        "email_from": s.resend_from,
        "test_mode_redirect": bool(s.notify_override_to),
        "anthropic_configured": bool(s.anthropic_api_key),
        "app_url": s.app_url,
    }
