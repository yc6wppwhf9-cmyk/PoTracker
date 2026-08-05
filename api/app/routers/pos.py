import hashlib
import io
import re
from typing import Any, Optional
import openpyxl

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import CurrentUser, get_current_user, require_roles
from app.routers.notify import notify_po_attached, notify_po_drafted_client
from app.supabase_client import fetch_all

router = APIRouter(prefix="/pos", tags=["pos"])

ALLOWED_EXT = (".pdf", ".xlsx", ".xls", ".png", ".jpg", ".jpeg")

PO_HEADER_ALIASES: dict[str, list[str]] = {
    "po_number": ["po number", "po no", "po #", "ponumber", "po", "po_id"],
    "item_code": ["component icode", "icode", "item code", "itemcode", "sku", "code", "item"],
    "ordered_qty": ["ordered qty", "order qty", "po qty", "qty", "quantity", "ordered"],
    "moq": ["moq", "minimum order quantity", "moq qty"],
    "supplier": ["supplier", "vendor", "party name", "party", "supplier name"],
    # The reconciliation view joins requirements to PO lines on
    # (item_code, lot, location), so these must survive the import.
    "lot": ["lot no", "lot number", "lot"],
    "location": ["location", "plant", "warehouse"],
}


def _norm(v: Any) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip().lower()


def _to_number(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s == "" or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _match_po_header(cell: str) -> Optional[str]:
    n = _norm(cell)
    if not n:
        return None
    for fieldname, aliases in PO_HEADER_ALIASES.items():
        if n in aliases:
            return fieldname
    for fieldname, aliases in sorted(
        PO_HEADER_ALIASES.items(),
        key=lambda kv: max(len(a) for a in kv[1]),
        reverse=True,
    ):
        for a in aliases:
            if len(a) >= 3 and a in n:
                return fieldname
    return None


@router.post("/{po_id}/upload")
def upload_po_document(
    po_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """PO team attaches the finalised PO document to a PO and marks it uploaded."""
    require_roles(user, "po_team")

    filename = file.filename or "po"
    if not filename.lower().endswith(ALLOWED_EXT):
        raise HTTPException(400, f"Allowed types: {', '.join(ALLOWED_EXT)}")

    data = file.file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")

    # Confirm the PO exists and is visible to this user (RLS: po_select).
    po = user.client.table("po").select("id, rm_sheet_id").eq("id", po_id).limit(1).execute()
    if not po.data:
        raise HTTPException(404, "PO not found.")

    ext = "." + filename.lower().rsplit(".", 1)[-1]
    path = f"{po_id}/document{ext}"

    content_type = {
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(ext, "application/octet-stream")

    try:
        user.client.storage.from_("po-docs").upload(
            path, data, {"content-type": content_type, "upsert": "true"}
        )
    except Exception as e:
        raise HTTPException(502, f"Storage upload failed: {e}")

    # Mark the PO uploaded (RLS po_update allows po_team).
    upd = (
        user.client.table("po")
        .update({"doc_path": path, "uploaded_by": user.id, "status": "uploaded"})
        .eq("id", po_id)
        .execute()
    )
    if not upd.data:
        raise HTTPException(500, "Failed to update PO record.")

    user.client.table("audit_log").insert(
        {
            "actor_id": user.id,
            "entity": "po",
            "entity_id": po_id,
            "action": "doc_uploaded",
            "detail": {"filename": filename, "path": path},
        }
    ).execute()

    # Hand off to the approver. Never fatal: the document is already stored.
    notified: dict[str, Any]
    try:
        notified = notify_po_attached(user.client, po_id)
    except Exception as e:
        notified = {"sent": False, "error": str(e)}

    return {
        "po_id": po_id,
        "doc_path": path,
        "status": "uploaded",
        "notified": notified,
    }


@router.post("/import-register")
def import_po_register(
    sheet_id: str = Form(...),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Automated PO Register Importer: Upload a PO Register (.xlsx) spreadsheet to
    automatically generate POs and PO line items without manual entry.
    """
    require_roles(user, "buyer", "po_team", "purchase_head")

    filename = file.filename or "po_register.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Please upload a .xlsx PO Register file.")

    data = file.file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")

    # Idempotency: re-importing the same register would double every ordered
    # quantity and silently corrupt reconciliation. `po` has no content_hash
    # column, so the previous import is detected via its audit_log entry.
    content_hash = hashlib.sha256(data).hexdigest()
    prior = (
        user.client.table("audit_log")
        .select("id, detail")
        .eq("entity", "po")
        .eq("action", "po_register_imported")
        .eq("entity_id", sheet_id)
        .execute()
    )
    for row in prior.data or []:
        if (row.get("detail") or {}).get("content_hash") == content_hash:
            return {
                "sheet_id": sheet_id,
                "idempotent": True,
                "pos_created": 0,
                "lines_inserted": 0,
                "message": "This exact PO register was already imported for this sheet.",
            }

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        ws = wb.worksheets[0]
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel workbook: {e}")

    # Locate header row
    header_row = 0
    cols: dict[str, int] = {}
    for r in range(1, min(ws.max_row, 15) + 1):
        found: dict[str, int] = {}
        for c in range(1, ws.max_column + 1):
            cell_val = ws.cell(row=r, column=c).value
            field_m = _match_po_header(str(cell_val)) if cell_val else None
            if field_m and field_m not in found:
                found[field_m] = c
        if "item_code" in found and "ordered_qty" in found:
            header_row = r
            cols = found
            break

    if not header_row:
        wb.close()
        raise HTTPException(
            422,
            "Could not locate required headers. Excel sheet must have an Item Code column (e.g., 'Item Code' or 'ICODE') and a Quantity column (e.g., 'Qty' or 'Ordered Qty').",
        )

    # Read data rows and group by PO Number
    po_groups: dict[str, list[dict[str, Any]]] = {}
    total_lines = 0

    for r_idx, row in enumerate(
        ws.iter_rows(min_row=header_row + 1, values_only=True), start=header_row + 1
    ):
        if row is None or all(v is None or str(v).strip() == "" for v in row):
            continue

        item_code_val = row[cols["item_code"] - 1] if cols.get("item_code") and cols["item_code"] - 1 < len(row) else None
        qty_val = _to_number(row[cols["ordered_qty"] - 1]) if cols.get("ordered_qty") and cols["ordered_qty"] - 1 < len(row) else None

        if not item_code_val or qty_val is None or qty_val <= 0:
            continue

        item_code = str(item_code_val).strip()
        po_num = (
            str(row[cols["po_number"] - 1]).strip()
            if cols.get("po_number") and cols["po_number"] - 1 < len(row) and row[cols["po_number"] - 1]
            else f"PO-{sheet_id[:6]}-IMP"
        )
        moq = (
            _to_number(row[cols["moq"] - 1])
            if cols.get("moq") and cols["moq"] - 1 < len(row)
            else 0.0
        ) or 0.0

        def _text(field: str) -> Optional[str]:
            idx = cols.get(field)
            if not idx or idx - 1 >= len(row):
                return None
            v = row[idx - 1]
            return str(v).strip() if v is not None and str(v).strip() != "" else None

        if po_num not in po_groups:
            po_groups[po_num] = []

        po_groups[po_num].append({
            "item_code": item_code,
            "lot": _text("lot"),
            "location": _text("location"),
            "ordered_qty": qty_val,
            "moq": moq,
        })
        total_lines += 1

    wb.close()

    if not po_groups:
        raise HTTPException(422, "No valid PO lines found in the uploaded register.")

    # `po_line.item_code` has a foreign key to `item_master`; an unknown code
    # aborts the whole batch insert. Drop those lines and report them instead.
    catalogue = fetch_all(
        lambda: user.client.table("item_master").select("item_code"),
        order_by="item_code",
    )
    known = {
        (c["item_code"] or "").strip().upper(): c["item_code"] for c in catalogue
    }
    unknown_codes: set[str] = set()
    for po_num in list(po_groups):
        kept = []
        for line in po_groups[po_num]:
            canonical = known.get(line["item_code"].strip().upper())
            if canonical is None:
                unknown_codes.add(line["item_code"])
                continue
            line["item_code"] = canonical  # normalise to catalogue casing
            kept.append(line)
        if kept:
            po_groups[po_num] = kept
        else:
            del po_groups[po_num]

    if not po_groups:
        raise HTTPException(
            422,
            "None of the item codes in this register exist in the catalogue "
            f"(e.g. {', '.join(sorted(unknown_codes)[:5])}). Import the item "
            "master first.",
        )

    # If the register carries no lot/location columns, inherit them from the
    # sheet's requirement lines where the item resolves unambiguously —
    # otherwise the reconciliation join produces phantom not_bought / extra pairs.
    if not cols.get("lot") and not cols.get("location"):
        reqs = fetch_all(
            lambda: user.client.table("rm_requirement")
            .select("item_code, lot, location")
            .eq("rm_sheet_id", sheet_id)
            .not_.is_("item_code", "null"),
            order_by="id",
        )
        by_item: dict[str, list[dict[str, Any]]] = {}
        for r in reqs:
            by_item.setdefault((r["item_code"] or "").strip().upper(), []).append(r)
        for lines in po_groups.values():
            for line in lines:
                candidates = by_item.get(line["item_code"].strip().upper(), [])
                if len(candidates) == 1:
                    line["lot"] = candidates[0].get("lot")
                    line["location"] = candidates[0].get("location")

    # Create PO records and PO lines in database
    created_pos = 0
    inserted_lines = 0

    failed_pos: list[str] = []

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
            failed_pos.append(po_num)
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
                "remark": f"Auto-imported from PO Register ({po_num})",
            }
            for l in lines
        ]
        try:
            line_res = user.client.table("po_line").insert(lines_payload).execute()
        except Exception:
            # Roll back the empty PO — otherwise it reads as a real order with
            # no lines and skews the reconciliation counts.
            user.client.table("po").delete().eq("id", po_id).execute()
            failed_pos.append(po_num)
            continue

        created_pos += 1
        inserted_lines += len(line_res.data or [])

    # Audit log entry
    user.client.table("audit_log").insert({
        "actor_id": user.id,
        "entity": "po",
        "entity_id": sheet_id,
        "action": "po_register_imported",
        "detail": {
            "filename": filename,
            "content_hash": content_hash,
            "pos_created": created_pos,
            "lines_inserted": inserted_lines,
            "skipped_unknown_items": sorted(unknown_codes),
            "failed_pos": failed_pos,
        },
    }).execute()

    message = (
        f"Imported {inserted_lines} PO line(s) across {created_pos} Purchase Order(s)."
    )
    if unknown_codes:
        message += (
            f" Skipped {len(unknown_codes)} item code(s) not in the catalogue: "
            f"{', '.join(sorted(unknown_codes)[:5])}"
            f"{'...' if len(unknown_codes) > 5 else ''}."
        )
    if failed_pos:
        message += f" Failed to import: {', '.join(failed_pos[:5])}."

    return {
        "sheet_id": sheet_id,
        "idempotent": False,
        "pos_created": created_pos,
        "lines_inserted": inserted_lines,
        "skipped_unknown_items": sorted(unknown_codes),
        "failed_pos": failed_pos,
        "message": message,
    }


# --------------------------------------------------------------------------
# Send a drafted PO: mark it as sent and notify the PO team. This is the action
# triggered by the buyer's "Send" button. Draft creation deliberately does not
# notify; only an explicit send should reach the PO team.
# --------------------------------------------------------------------------
@router.post("/{po_id}/send")
def send_po(
    po_id: str, user: CurrentUser = Depends(get_current_user)
):
    require_roles(user, "buyer")
    # Confirm PO exists and is visible to this user (RLS: po_select).
    po = (
        user.client.table("po")
        .select("id, rm_sheet_id, created_by, status")
        .eq("id", po_id)
        .limit(1)
        .execute()
    )
    if not po.data:
        raise HTTPException(404, "PO not found.")
    row = po.data[0]
    # Only the creator may send their draft.
    if row.get("created_by") != user.id:
        raise HTTPException(403, "You are not allowed to send this PO.")
    if row.get("status") != "draft":
        return {"sent": False, "skipped": True, "reason": "PO is not a draft."}

    upd = (
        user.client.table("po")
        .update({"status": "sent", "sent_by": user.id})
        .eq("id", po_id)
        .execute()
    )
    if not upd.data:
        raise HTTPException(500, "Failed to update PO status.")

    # Audit
    user.client.table("audit_log").insert({
        "actor_id": user.id,
        "entity": "po",
        "entity_id": po_id,
        "action": "po_sent",
        "detail": {"rm_sheet_id": row.get("rm_sheet_id")},
    }).execute()

    # Notify the PO team. Non-fatal: the PO status is already updated.
    try:
        notified = notify_po_drafted_client(user.client, po_id)
    except Exception as e:
        notified = {"sent": False, "error": str(e)}

    return {"po_id": po_id, "status": "sent", "notified": notified}
