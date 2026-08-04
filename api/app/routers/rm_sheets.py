import datetime
import hashlib
import re
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import CurrentUser, get_current_user, require_roles
from app.parsing import parse_rm_sheet
from app.supabase_client import fetch_all

router = APIRouter(prefix="/rm-sheets", tags=["rm-sheets"])

XLSX_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",  # some browsers
}


def _load_catalogue(user: CurrentUser):
    """item_code -> base_unit, and (item_code, unit_lower) -> factor_to_base.

    Paged: a catalogue larger than 1000 items would otherwise come back
    truncated, and every item past the cut would be treated as unknown.
    """
    items = fetch_all(
        lambda: user.client.table("item_master").select("item_code, base_unit"),
        order_by="item_code",
    )
    by_code: dict[str, dict[str, Any]] = {}
    for it in items:
        by_code[it["item_code"].strip().upper()] = {
            "item_code": it["item_code"],
            "base_unit": (it["base_unit"] or "").strip().lower(),
        }

    factors: dict[tuple[str, str], float] = {}
    for u in fetch_all(
        lambda: user.client.table("uom_conversion").select(
            "item_code, from_unit, factor_to_base"
        ),
        order_by="item_code",
    ):
        factors[(u["item_code"], (u["from_unit"] or "").strip().lower())] = float(
            u["factor_to_base"]
        )
    return by_code, factors


@router.post("")
def upload_rm_sheet(
    file: UploadFile = File(...),
    style_ref: Optional[str] = Form(default=None),
    reparse: bool = Form(default=False),
    user: CurrentUser = Depends(get_current_user),
):
    require_roles(user, "uploader")

    filename = file.filename or "sheet.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Please upload an .xlsx file.")

    data = file.file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")
    content_hash = hashlib.sha256(data).hexdigest()

    # Idempotency: same bytes uploaded by the same user -> return the existing sheet.
    existing = (
        user.client.table("rm_sheet")
        .select("id, status, created_at")
        .eq("uploaded_by", user.id)
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    if existing.data:
        sheet = existing.data[0]
        if not reparse:
            return {
                "rm_sheet_id": sheet["id"],
                "idempotent": True,
                "reparsable": True,
                "message": (
                    "This exact sheet was already uploaded. Re-parse it to "
                    "rebuild the requirement lines with the current rules."
                ),
            }
        # Re-parse: the file is unchanged but the parsing rules have. Clear the
        # derived requirement lines and rebuild them in place, keeping the same
        # sheet id so assignments elsewhere still point at something real.
        # POs are deliberately left alone — they are real orders, not derived.
        user.client.table("rm_requirement").delete().eq(
            "rm_sheet_id", sheet["id"]
        ).execute()
        user.client.table("audit_log").insert(
            {
                "actor_id": user.id,
                "entity": "rm_sheet",
                "entity_id": sheet["id"],
                "action": "reparsed",
                "detail": {"filename": filename},
            }
        ).execute()
        existing_sheet_id = sheet["id"]
    else:
        existing_sheet_id = None

    # Parse (structural only).
    try:
        parsed = parse_rm_sheet(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not parsed.rows:
        raise HTTPException(422, "No requirement rows found in the sheet.")

    by_code, factors = _load_catalogue(user)

    # Generate a sequential Material Requisition (MR) number if not supplied
    # (MR-2026-001, MR-2026-002, ...).
    warnings: list[str] = []
    if not style_ref or not style_ref.strip():
        year_str = datetime.datetime.now().strftime("%Y")
        prefix = f"MR-{year_str}-"
        seq_re = re.compile(rf"^{re.escape(prefix)}(\d+)$")

        try:
            existing = (
                user.client.table("rm_sheet")
                .select("style_ref")
                .ilike("style_ref", f"{prefix}%")
                .execute()
            )
            max_seq = 0
            for r in existing.data or []:
                match = seq_re.match((r.get("style_ref") or "").strip())
                if match:
                    max_seq = max(max_seq, int(match.group(1)))
            style_ref = f"{prefix}{max_seq + 1:03d}"
        except Exception as e:
            # Fall back to a unique-but-unordered reference rather than failing the
            # upload — but say so, so nobody assumes the sequence is intact.
            style_ref = f"{prefix}{uuid.uuid4().hex[:4].upper()}"
            warnings.append(
                f"Could not read existing MR numbers ({e}); assigned "
                f"non-sequential reference {style_ref}."
            )
    else:
        style_ref = style_ref.strip()

    # Re-parse reuses the existing sheet so anything already pointing at it
    # (POs, approvals) keeps working; a fresh upload creates the record.
    if existing_sheet_id:
        sheet_row = (
            user.client.table("rm_sheet")
            .update({"status": "uploaded"})
            .eq("id", existing_sheet_id)
            .execute()
        )
    else:
        sheet_row = (
            user.client.table("rm_sheet")
            .insert(
                {
                    "style_ref": style_ref,
                    "uploaded_by": user.id,
                    "content_hash": content_hash,
                    "status": "uploaded",
                }
            )
            .execute()
        )
    if not sheet_row.data:
        raise HTTPException(500, "Failed to create sheet record.")
    sheet_id = sheet_row.data[0]["id"]

    # Store the original file (audit / re-download). Non-fatal if it fails.
    file_path = f"{user.id}/{sheet_id}.xlsx"
    storage_ok = True
    try:
        user.client.storage.from_("rm-sheets").upload(
            file_path,
            data,
            {
                "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "upsert": "true",
            },
        )
        user.client.table("rm_sheet").update({"file_path": file_path}).eq(
            "id", sheet_id
        ).execute()
    except Exception as e:
        storage_ok = False
        warnings.append(f"The original file was not archived to Storage ({e}).")

    # Collect new SKUs for bulk auto-registration
    new_skus: dict[str, dict[str, Any]] = {}
    for pr in parsed.rows:
        if pr.required_qty is None:
            continue
        code_key = (pr.raw_code or "").strip().upper()
        if code_key and code_key not in by_code and pr.department and pr.department.strip():
            raw_code = pr.raw_code.strip()
            new_skus[code_key] = {
                "item_code": raw_code,
                "name": (pr.item_name or raw_code).strip(),
                "category": pr.department.strip(),
                "base_unit": pr.raw_unit or "pcs",
                "moq": 0,
            }

    # Bulk upsert new SKUs into item_master in batches of 500. These are
    # provisional catalogue entries (moq 0, category taken from the sheet's
    # department) — the lines that created them still go to human review below.
    auto_registered: set[str] = set()
    if new_skus:
        sku_list = list(new_skus.values())
        CHUNK_SKU = 500
        for i in range(0, len(sku_list), CHUNK_SKU):
            chunk = sku_list[i : i + CHUNK_SKU]
            try:
                user.client.table("item_master").upsert(
                    chunk, on_conflict="item_code"
                ).execute()
                auto_registered.update(s["item_code"].strip().upper() for s in chunk)
            except Exception as e:
                # Most likely RLS: this role may not write item_master. Surface it
                # instead of silently dropping the catalogue entries.
                warnings.append(
                    f"Could not auto-register {len(chunk)} new item code(s) in the "
                    f"catalogue ({e}); those lines are flagged for review."
                )
        # Refresh catalogue cache
        by_code, factors = _load_catalogue(user)

    # Build requirement rows. `provisional` (auto-registered from this sheet)
    # is tracked for the audit log only — it counts as matched for the uploader.
    to_insert: list[dict[str, Any]] = []
    matched = provisional = unresolved = 0

    for pr in parsed.rows:
        code_key = (pr.raw_code or "").strip().upper()
        hit = by_code.get(code_key) if code_key else None

        # The sheet is the source of truth. A code we auto-registered a moment
        # ago is a normal catalogue hit by now, so it counts as matched.
        #
        # `item_code` must be NULL rather than the raw code when there is no
        # catalogue entry: the column has a foreign key to item_master, so
        # writing an unregistered code would fail the whole batch insert and
        # 500 the upload. `raw_code` keeps the original either way.
        item_code = hit["item_code"] if hit else None
        needs_review = not hit
        qty = float(pr.required_qty)

        if hit and pr.raw_unit and pr.raw_unit.strip().lower() != hit["base_unit"]:
            factor = factors.get((item_code, pr.raw_unit.strip().lower()))
            if factor is not None:
                qty = qty * factor
            else:
                needs_review = True

        to_insert.append(
            {
                "rm_sheet_id": sheet_id,
                "item_code": item_code,
                "required_qty": qty,
                "raw_label": pr.item_name,
                "raw_unit": pr.raw_unit,
                "raw_code": pr.raw_code,
                "needs_review": needs_review,
                "lot": pr.lot,
                "department": pr.department,
                "color": pr.color,
                "location": pr.location,
                "raw_row": pr.raw_row,
            }
        )
        if hit:
            matched += 1
            if code_key in auto_registered:
                provisional += 1
        else:
            unresolved += 1

    # Insert requirement rows in chunks.
    CHUNK = 500
    for i in range(0, len(to_insert), CHUNK):
        user.client.table("rm_requirement").insert(to_insert[i : i + CHUNK]).execute()

    distinct_items = len({r["item_code"] for r in to_insert if r["item_code"]})

    # Auto-extract POs if PO numbers are present in the sheet
    auto_pos_created = 0
    auto_lines_inserted = 0
    po_groups: dict[str, list[dict[str, Any]]] = {}

    for pr in parsed.rows:
        po_num = (pr.po or "").strip()
        code_key = (pr.raw_code or "").strip().upper()
        hit = by_code.get(code_key) if code_key else None
        item_code = hit["item_code"] if hit else None

        if po_num and item_code and pr.required_qty:
            if po_num not in po_groups:
                po_groups[po_num] = []
            po_groups[po_num].append({
                "item_code": item_code,
                "lot": pr.lot,
                "location": pr.location,
                "ordered_qty": float(pr.required_qty),
                "moq": 0.0,
            })

    for po_num, lines in po_groups.items():
        po_res = (
            user.client.table("po")
            .insert({
                "rm_sheet_id": sheet_id,
                "created_by": user.id,
                "status": "uploaded",
            })
            .execute()
        )
        if not po_res.data:
            warnings.append(f"Could not create the PO record for '{po_num}'.")
            continue

        po_id = po_res.data[0]["id"]
        lines_payload = [
            {
                "po_id": po_id,
                "item_code": l["item_code"],
                "lot": l.get("lot"),
                "location": l.get("location"),
                "ordered_qty": l["ordered_qty"],
                "moq": l["moq"],
                "remark": f"Auto-extracted from sheet ({po_num})",
            }
            for l in lines
        ]
        try:
            l_res = user.client.table("po_line").insert(lines_payload).execute()
        except Exception as e:
            # Don't leave an empty PO behind — it would read as a real order
            # with nothing on it and skew reconciliation.
            user.client.table("po").delete().eq("id", po_id).execute()
            warnings.append(f"Skipped PO '{po_num}': could not insert its lines ({e}).")
            continue

        auto_pos_created += 1
        auto_lines_inserted += len(l_res.data or [])

    # Audit.
    user.client.table("audit_log").insert(
        {
            "actor_id": user.id,
            "entity": "rm_sheet",
            "entity_id": sheet_id,
            "action": "uploaded",
            "detail": {
                "filename": filename,
                "lines": len(to_insert),
                "matched": matched,
                "provisional": provisional,
                "unresolved": unresolved,
                "needs_review": unresolved,
                "skipped": parsed.skipped_rows,
                "distinct_items": distinct_items,
                "storage_ok": storage_ok,
                "style_ref": style_ref,
                "auto_registered_items": len(auto_registered),
                "auto_pos_created": auto_pos_created,
                "auto_lines_inserted": auto_lines_inserted,
                "warnings": warnings,
            },
        }
    ).execute()

    return {
        "rm_sheet_id": sheet_id,
        "idempotent": False,
        "filename": filename,
        "style_ref": style_ref,
        "lines": len(to_insert),
        "matched": matched,
        "unresolved": unresolved,
        "needs_review": unresolved,
        "skipped": parsed.skipped_rows,
        "distinct_items": distinct_items,
        "auto_registered_items": len(auto_registered),
        "auto_pos_created": auto_pos_created,
        "auto_lines_inserted": auto_lines_inserted,
        "storage_ok": storage_ok,
        "warnings": parsed.warnings + warnings,
    }
