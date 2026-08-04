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
    return {"status": "ok"}
