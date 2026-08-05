from typing import Any, Optional
import os

from fastapi import APIRouter, Depends, HTTPException

from app.auth import CurrentUser, get_current_user, require_roles
from app.config import get_settings
from app.supabase_client import fetch_all

router = APIRouter(prefix="/ai", tags=["ai"])


MODEL = "claude-opus-5"


def _call_claude(prompt: str, system: str = "") -> Optional[str]:
    """Call the Claude API if a key is present, returning the text or None."""
    settings = get_settings()
    api_key = settings.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        # Safety classifiers can decline a request: HTTP 200 with no usable
        # content. Check before reading blocks.
        if response.stop_reason == "refusal":
            print(f"[Claude] request refused: {response.stop_details}")
            return None
        # `content` interleaves thinking and text blocks — take the text.
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return text or None
    except Exception as e:
        print(f"[Claude AI Error] {e}")
    return None


@router.post("/rm-sheets/{sheet_id}/summary")
def generate_executive_summary(
    sheet_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """
    Generate an AI Executive Summary for an RM sheet reconciliation report.
    Usable by approvers, MD, and admins.
    """
    require_roles(user, "approver", "md")

    # Fetch sheet info
    sheet_res = (
        user.client.table("rm_sheet")
        .select("id, style_ref, status, created_at")
        .eq("id", sheet_id)
        .limit(1)
        .execute()
    )
    if not sheet_res.data:
        raise HTTPException(404, "RM sheet not found.")
    sheet = sheet_res.data[0]

    # Fetch reconciliation view rows (paged — a large sheet exceeds 1000).
    recon_rows = fetch_all(
        lambda: user.client.table("reconciliation")
        .select("*")
        .eq("rm_sheet_id", sheet_id),
        order_by="item_code",
    )

    # Compute status counts and variance details
    counts: dict[str, int] = {}
    over_buys: list[dict[str, Any]] = []
    not_bought: list[dict[str, Any]] = []

    for r in recon_rows:
        st = r.get("status") or "unknown"
        counts[st] = counts.get(st, 0) + 1

        # Column names come from the `reconciliation` view: name / required /
        # ordered / variance — not raw_label / required_qty / purchased_qty.
        if st == "over_buy":
            over_buys.append({
                "item_code": r.get("item_code"),
                "label": r.get("name"),
                "required": r.get("required"),
                "bought": r.get("ordered"),
                "variance": r.get("variance"),
            })
        elif st == "not_bought":
            not_bought.append({
                "item_code": r.get("item_code"),
                "label": r.get("name"),
                "required": r.get("required"),
            })

    total_items = len(recon_rows)
    style_ref = sheet.get("style_ref") or sheet_id[:8]

    # Build prompt for Claude
    system_prompt = (
        "You are an expert Procurement & Supply Chain Auditor. Write a concise, professional executive summary "
        "for the Managing Director regarding an RM requirement vs Purchase Order reconciliation sheet."
    )

    user_prompt = f"""Style / Reference: {style_ref}
Total Requirement Lines: {total_items}

Reconciliation Breakdown:
- On Target: {counts.get('on_target', 0)}
- Partial Buy: {counts.get('partial', 0)}
- Over Buy: {counts.get('over_buy', 0)}
- Not Bought: {counts.get('not_bought', 0)}
- Extra (Not in Sheet): {counts.get('extra_not_in_sheet', 0)}

Over-Buy Items Detail:
{over_buys[:5]}

Not Bought Items Detail:
{not_bought[:5]}

Write a clear, 3-4 sentence executive summary highlighting total fulfillment, key risks or discrepancies (such as over-buys or unpurchased items), and recommendations for the MD's approval decision. Do not use bullet points or markdown headings.
"""

    ai_text = _call_claude(user_prompt, system=system_prompt)

    if ai_text:
        summary = ai_text.strip()
        ai_generated = True
    else:
        # Fallback deterministic summary
        parts = []
        for status_key, label in [
            ("on_target", "on target"),
            ("partial", "partially fulfilled"),
            ("over_buy", "over-bought"),
            ("not_bought", "not bought"),
            ("extra_not_in_sheet", "extra items"),
        ]:
            c = counts.get(status_key, 0)
            if c > 0:
                parts.append(f"{c} {label}")
        summary = f"Reconciliation digest for {style_ref}: " + (", ".join(parts) if parts else "No lines reconciled.") + "."
        ai_generated = False

    return {
        "sheet_id": sheet_id,
        "style_ref": style_ref,
        "summary": summary,
        "ai_generated": ai_generated,
        "counts": counts,
    }


@router.post("/rm-sheets/{sheet_id}/fuzzy-match")
def fuzzy_match_items(
    sheet_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """
    Use Claude AI to suggest item_master catalogue matches for unmatched requirements ('needs_review').
    """
    require_roles(user, "uploader", "purchase_head")

    # Fetch requirement lines needing review
    req_res = (
        user.client.table("rm_requirement")
        .select("id, raw_code, raw_label, raw_unit, required_qty")
        .eq("rm_sheet_id", sheet_id)
        .eq("needs_review", True)
        .execute()
    )
    unmatched = req_res.data or []
    if not unmatched:
        return {"matched_count": 0, "suggestions": [], "message": "No lines need review."}

    # Fetch catalogue items. The column is `name`, not `item_name`.
    cat_res = (
        user.client.table("item_master")
        .select("item_code, name, category, base_unit")
        .execute()
    )
    cat_items = cat_res.data or []

    if not cat_items:
        return {"matched_count": 0, "suggestions": [], "message": "Item catalogue is empty."}

    system_prompt = (
        "You are an intelligent inventory mapping assistant. Your job is to match raw material requirement descriptions "
        "to standard item codes in the master catalogue based on name similarity, material attributes, and standard procurement conventions."
    )

    user_prompt = f"""Unmatched Requirement Lines:
{unmatched[:10]}

Master Item Catalogue (Sample):
{cat_items[:50]}

For each unmatched requirement item, suggest the best matching item_code from the catalogue, confidence score (0.0 to 1.0), and concise rationale.
Format response as a simple list of matches.
"""

    ai_text = _call_claude(user_prompt, system=system_prompt)

    return {
        "sheet_id": sheet_id,
        "unmatched_count": len(unmatched),
        "ai_suggestions": ai_text or "Claude API unavailable for automated fuzzy matching.",
        "ai_generated": bool(ai_text),
    }
