"""Reconciliation export for the approval stage.

Produces an .xlsx the approver and MD can circulate: a KPI summary first, then
one tab per reconciliation status so a reviewer can drill into whichever KPI
looks wrong without filtering a single flat sheet.
"""
from __future__ import annotations

import datetime
import io
from typing import Any
from urllib.parse import quote

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import CurrentUser, get_current_user, require_roles
from app.supabase_client import fetch_all

router = APIRouter(prefix="/exports", tags=["exports"])

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Order matters: worst news first, so a reviewer meets the problems before the
# lines that are already fine.
STATUS_ORDER: list[tuple[str, str]] = [
    ("over_buy", "Over-buy"),
    ("partial", "Partial"),
    ("not_bought", "Not bought"),
    ("extra_not_in_sheet", "Extra (not in sheet)"),
    ("on_target", "On target"),
]

DETAIL_COLUMNS = [
    ("item_code", "Item code"),
    ("name", "Item name"),
    ("category", "Category"),
    ("location", "Plant"),
    ("lot", "Lot"),
    ("base_unit", "Unit"),
    ("required", "Required"),
    ("ordered", "Ordered"),
    ("variance", "Variance"),
    ("variance_pct", "Variance %"),
    ("status", "Status"),
]

HEAD_FILL = PatternFill("solid", fgColor="1F2937")
HEAD_FONT = Font(color="FFFFFF", bold=True, size=10)
TITLE_FONT = Font(bold=True, size=14)
THIN = Side(style="thin", color="D1D5DB")
BORDER = Border(bottom=THIN)


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _autosize(ws, widths: dict[int, int]) -> None:
    for idx, width in widths.items():
        ws.column_dimensions[get_column_letter(idx)].width = width


def _write_header(ws, headers: list[str], row: int = 1) -> None:
    for c, h in enumerate(headers, start=1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.fill = HEAD_FILL
        cell.font = HEAD_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


@router.get("/rm-sheets/{sheet_id}/reconciliation.xlsx")
def export_reconciliation(
    sheet_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """KPI-oriented reconciliation workbook for the approval stage."""
    require_roles(user, "approver", "md", "purchase_head", "po_team")

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
    style_ref = sheet.get("style_ref") or sheet_id[:8]

    rows = fetch_all(
        lambda: user.client.table("reconciliation")
        .select("*")
        .eq("rm_sheet_id", sheet_id),
        order_by="item_code",
    )
    if not rows:
        raise HTTPException(422, "Nothing to export — this sheet has no reconciled lines.")

    by_status: dict[str, list[dict[str, Any]]] = {k: [] for k, _ in STATUS_ORDER}
    for r in rows:
        by_status.setdefault(r.get("status") or "unknown", []).append(r)

    wb = openpyxl.Workbook()

    # ---------- Summary (KPIs) ----------
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = f"Reconciliation — {style_ref}"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = f"Sheet status: {sheet.get('status')}"
    ws["A3"] = (
        "Generated "
        f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} by {user.email or user.id}"
    )
    for r in (2, 3):
        ws.cell(row=r, column=1).font = Font(size=9, color="6B7280")

    _write_header(
        ws,
        ["KPI", "Lines", "% of lines", "Required", "Ordered", "Variance"],
        row=5,
    )

    total_lines = len(rows)
    row_i = 6
    for key, label in STATUS_ORDER:
        group = by_status.get(key, [])
        req = sum(_num(g.get("required")) for g in group)
        order = sum(_num(g.get("ordered")) for g in group)
        ws.cell(row=row_i, column=1, value=label)
        ws.cell(row=row_i, column=2, value=len(group))
        pct = ws.cell(
            row=row_i,
            column=3,
            value=(len(group) / total_lines) if total_lines else 0,
        )
        pct.number_format = "0.0%"
        for col, val in ((4, req), (5, order), (6, order - req)):
            c = ws.cell(row=row_i, column=col, value=val)
            c.number_format = "#,##0.00"
        for col in range(1, 7):
            ws.cell(row=row_i, column=col).border = BORDER
        row_i += 1

    total_req = sum(_num(r.get("required")) for r in rows)
    total_ord = sum(_num(r.get("ordered")) for r in rows)
    ws.cell(row=row_i, column=1, value="TOTAL").font = Font(bold=True)
    ws.cell(row=row_i, column=2, value=total_lines).font = Font(bold=True)
    for col, val in ((4, total_req), (5, total_ord), (6, total_ord - total_req)):
        c = ws.cell(row=row_i, column=col, value=val)
        c.number_format = "#,##0.00"
        c.font = Font(bold=True)

    # Headline KPIs — the two an approver is actually judged on.
    on_target = len(by_status.get("on_target", []))
    row_i += 2
    for label, value, fmt in (
        ("Fulfilment rate (on target / all lines)",
         (on_target / total_lines) if total_lines else 0, "0.0%"),
        ("Lines with no PO raised", len(by_status.get("not_bought", [])), "#,##0"),
    ):
        ws.cell(row=row_i, column=1, value=label).font = Font(bold=True)
        c = ws.cell(row=row_i, column=2, value=value)
        c.number_format = fmt
        c.font = Font(bold=True)
        row_i += 1

    _autosize(ws, {1: 40, 2: 12, 3: 12, 4: 16, 5: 16, 6: 16})

    # ---------- One tab per KPI ----------
    for key, label in STATUS_ORDER:
        group = by_status.get(key, [])
        tab = wb.create_sheet(label[:31])
        _write_header(tab, [h for _, h in DETAIL_COLUMNS])
        for i, r in enumerate(group, start=2):
            req = _num(r.get("required"))
            for c, (field, _) in enumerate(DETAIL_COLUMNS, start=1):
                if field == "variance_pct":
                    # No requirement means no denominator — an extra line has
                    # nothing to be a percentage of.
                    v = (_num(r.get("variance")) / req) if req else None
                else:
                    v = r.get(field)
                cell = tab.cell(row=i, column=c, value=v)
                if field in ("required", "ordered", "variance"):
                    cell.number_format = "#,##0.00"
                elif field == "variance_pct":
                    cell.number_format = "+0.0%;-0.0%;0.0%"
        if not group:
            tab.cell(row=2, column=1, value="— none —").font = Font(
                italic=True, color="6B7280"
            )
        _autosize(
            tab,
            {1: 14, 2: 34, 3: 20, 4: 18, 5: 14, 6: 10, 7: 14, 8: 14, 9: 14,
             10: 10, 11: 14, 12: 12, 13: 18},
        )

    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    buf.seek(0)

    user.client.table("audit_log").insert(
        {
            "actor_id": user.id,
            "entity": "rm_sheet",
            "entity_id": sheet_id,
            "action": "reconciliation_exported",
            "detail": {"lines": total_lines, "style_ref": style_ref},
        }
    ).execute()

    filename = f"reconciliation-{style_ref}.xlsx".replace(" ", "-")
    return StreamingResponse(
        buf,
        media_type=XLSX_MEDIA,
        headers={
            # RFC 5987 — style_ref may contain non-ASCII.
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )
