"""Import the GRN (GRC) register and match it back to purchase orders."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.auth import CurrentUser, get_current_user, require_roles
from app.grn_parsing import parse_grn_register
from app.supabase_client import fetch_all

router = APIRouter(prefix="/grn", tags=["grn"])

ALLOWED_EXT = (".xlsx", ".xlsm", ".xls")


@router.post("/import")
def import_grn_register(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Load a GRC register export.

    Re-importing is safe and is the expected way to load a corrected register:
    every GRC number present in the file has its existing lines replaced, so a
    quantity fixed at source overwrites rather than adds. GRC numbers absent
    from the file are left alone, so a monthly export does not erase history.
    """
    require_roles(user, "po_team", "purchase_head", "admin")

    filename = file.filename or "grn"
    if not filename.lower().endswith(ALLOWED_EXT):
        raise HTTPException(400, f"Allowed types: {', '.join(ALLOWED_EXT)}")

    data = file.file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")

    try:
        parsed = parse_grn_register(data)
    except Exception as e:
        raise HTTPException(400, f"Could not read the register: {e}")

    if not parsed["header_found"]:
        raise HTTPException(
            400,
            "No recognisable header row was found. Expected columns including "
            "GRC NO., PO NO., BARCODE and QTY.",
        )

    rows: list[dict[str, Any]] = parsed["rows"]
    if not rows:
        return {
            "imported": 0,
            "reason": "The register contained no receipt lines with a positive quantity.",
            **{k: parsed[k] for k in ("parsed", "skipped_no_grc", "skipped_no_qty")},
        }

    # Replace-by-GRC. Chunked because a register can carry thousands of numbers
    # and the delete filter is built from them.
    grc_numbers = sorted({r["grc_no"] for r in rows})
    for i in range(0, len(grc_numbers), 200):
        chunk = grc_numbers[i : i + 200]
        user.client.table("grn").delete().in_("grc_no", chunk).execute()

    inserted = 0
    for i in range(0, len(rows), 500):
        chunk = [{**r, "imported_by": user.id} for r in rows[i : i + 500]]
        res = user.client.table("grn").insert(chunk).execute()
        inserted += len(res.data or [])

    matched = _match_summary(user, rows)

    user.client.table("audit_log").insert(
        {
            "actor_id": user.id,
            "entity": "grn",
            "entity_id": None,
            "action": "grn_imported",
            "detail": {
                "filename": filename,
                "receipts": len(grc_numbers),
                "lines": inserted,
                **matched["counts"],
            },
        }
    ).execute()

    return {
        "imported": inserted,
        "receipts": len(grc_numbers),
        "merged_duplicate_lines": parsed["merged"],
        "skipped_no_grc": parsed["skipped_no_grc"],
        "skipped_no_qty": parsed["skipped_no_qty"],
        **matched,
    }


def _match_summary(user: CurrentUser, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Report how much of the import could be tied to a known purchase order.

    An unmatched receipt is not an error — goods can arrive against a PO raised
    outside this system — but it is the number that says whether PO numbers are
    being captured properly, so it is reported rather than left to be noticed.
    """
    pos = fetch_all(
        lambda: user.client.table("po").select("id, po_number").not_.is_(
            "po_number", "null"
        ),
        order_by="id",
    )
    known = {str(p["po_number"]).upper() for p in pos if p.get("po_number")}

    with_po = [r for r in rows if r.get("po_number")]
    matched = [r for r in with_po if r["po_number"] in known]
    unmatched = [r for r in with_po if r["po_number"] not in known]
    no_number = [r for r in rows if not r.get("po_number")]

    # A handful of examples makes an unmatched batch diagnosable at a glance —
    # usually a PO number that was never captured from its document.
    examples = sorted({r["po_number"] for r in unmatched})[:5]

    return {
        "counts": {
            "matched_lines": len(matched),
            "unmatched_lines": len(unmatched),
            "lines_without_po_number": len(no_number),
        },
        "unmatched_po_numbers": examples,
    }
