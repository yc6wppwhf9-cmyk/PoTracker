import io

from openpyxl import Workbook

from app.grn_parsing import match_header, parse_grn_register

# The register's real header row, verbatim.
HEADERS = [
    "Stock Point Name", "Supplier Name", "GRC NO.", "GRC DATE", "DOC DATE",
    "DOC NO", "PO DATE", "PO NO.", "LOT NO.", "DEPARTMENT", "BARCODE",
    "ITEM_NAME", "QTY", "Per Item Cost (Landed Value)", "Landed Cost",
    "Total Value of Invoice", "Basic Amt.", "IGST Rate", "IGST Amount",
    "CGST Rate", "CGST Amount", "SGST Rate", "SGST Amount", "Other Charges",
    "Freight", "Dispatch", "Remarks",
]


def _row(**kw):
    r = [None] * len(HEADERS)
    idx = {h: i for i, h in enumerate(HEADERS)}
    for k, v in kw.items():
        r[idx[k]] = v
    return r


def _book(rows, headers=HEADERS):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_maps_the_real_headers():
    assert match_header("GRC NO.") == "grc_no"
    assert match_header("PO NO.") == "po_number"
    assert match_header("PO DATE") == "po_date"
    assert match_header("BARCODE") == "item_code"
    assert match_header("LOT NO.") == "lot"
    assert match_header("QTY") == "qty"
    assert match_header("Stock Point Name") == "stock_point"
    assert match_header("Supplier Name") == "supplier"


def test_po_date_is_not_swallowed_by_po_no():
    """Both start with 'PO'; confusing them would date every receipt wrongly."""
    assert match_header("PO NO.") == "po_number"
    assert match_header("PO DATE") == "po_date"


def test_value_columns_are_not_mistaken_for_quantity():
    """'Total Value of Invoice' must not be read as the received quantity."""
    assert match_header("Total Value of Invoice") != "qty"
    assert match_header("Basic Amt.") != "qty"
    assert match_header("IGST Amount") != "qty"


def test_parses_a_receipt_line():
    data = _book([
        _row(**{
            "Stock Point Name": "High Spirit Commercial Ventures Pvt Ltd - Muzaffarpur",
            "Supplier Name": "Arora Polyfab India Private Limited (Cr)",
            "GRC NO.": "GRC/001", "GRC DATE": "25-07-2026",
            "PO NO.": "PO/HSM/00000910/26-27", "PO DATE": "22-07-2026",
            "LOT NO.": "Lot 3", "BARCODE": "INV29423",
            "ITEM_NAME": "FB PVC Leather Cloth NBL", "QTY": 3085,
        })
    ])
    out = parse_grn_register(data)
    assert out["header_found"] is True
    assert len(out["rows"]) == 1
    r = out["rows"][0]
    assert r["grc_no"] == "GRC/001"
    assert r["po_number"] == "PO/HSM/00000910/26-27"
    assert r["item_code"] == "INV29423"
    assert r["lot"] == "Lot 3"
    assert r["qty"] == 3085
    assert r["grc_date"] == "2026-07-25"
    assert r["po_date"] == "2026-07-22"


def test_po_number_is_normalised_for_matching():
    """Typed in two systems — case and stray spaces must not prevent a match."""
    data = _book([
        _row(**{"GRC NO.": "G1", "PO NO.": " po/hsm/00000910/26-27 ",
                "BARCODE": "INV1", "QTY": 5})
    ])
    assert parse_grn_register(data)["rows"][0]["po_number"] == "PO/HSM/00000910/26-27"


def test_skips_zero_and_negative_quantities():
    """A zero or negative row is a correction, not goods arriving."""
    data = _book([
        _row(**{"GRC NO.": "G1", "BARCODE": "INV1", "QTY": 0}),
        _row(**{"GRC NO.": "G2", "BARCODE": "INV2", "QTY": -10}),
        _row(**{"GRC NO.": "G3", "BARCODE": "INV3", "QTY": 7}),
    ])
    out = parse_grn_register(data)
    assert len(out["rows"]) == 1
    assert out["skipped_no_qty"] == 2


def test_skips_rows_with_no_grc_number():
    data = _book([_row(**{"BARCODE": "INV1", "QTY": 5})])
    out = parse_grn_register(data)
    assert out["rows"] == []
    assert out["skipped_no_grc"] == 1


def test_sums_repeated_lines_within_one_file():
    """The same receipt line split across two rows is one arrival, not two."""
    data = _book([
        _row(**{"GRC NO.": "G1", "BARCODE": "INV1", "LOT NO.": "Lot 1", "QTY": 100}),
        _row(**{"GRC NO.": "G1", "BARCODE": "INV1", "LOT NO.": "Lot 1", "QTY": 50}),
    ])
    out = parse_grn_register(data)
    assert len(out["rows"]) == 1
    assert out["rows"][0]["qty"] == 150
    assert out["merged"] == 1


def test_separate_receipts_of_the_same_item_stay_separate():
    """Two deliveries against one PO line must both count."""
    data = _book([
        _row(**{"GRC NO.": "G1", "BARCODE": "INV1", "LOT NO.": "Lot 1", "QTY": 100}),
        _row(**{"GRC NO.": "G2", "BARCODE": "INV1", "LOT NO.": "Lot 1", "QTY": 60}),
    ])
    out = parse_grn_register(data)
    assert len(out["rows"]) == 2
    assert sum(r["qty"] for r in out["rows"]) == 160


def test_tolerates_a_title_row_above_the_header():
    wb = Workbook()
    ws = wb.active
    ws.append(["GRC Register — July 2026"])
    ws.append([])
    ws.append(HEADERS)
    ws.append(_row(**{"GRC NO.": "G1", "BARCODE": "INV1", "QTY": 12}))
    buf = io.BytesIO()
    wb.save(buf)
    out = parse_grn_register(buf.getvalue())
    assert out["header_found"] is True
    assert len(out["rows"]) == 1


def test_keeps_the_columns_that_are_used():
    data = _book([_row(**{"GRC NO.": "G1", "BARCODE": "INV1", "QTY": 3,
                          "Remarks": "short supply"})])
    r = parse_grn_register(data)["rows"][0]
    assert r["remarks"] == "short supply"


def test_does_not_keep_a_copy_of_every_cell():
    """Holding the whole sheet per row exhausted the hosted instance and had
    the process killed mid-upload, which reached the browser as a network
    failure. The source file is the diagnosis."""
    data = _book([_row(**{"GRC NO.": "G1", "BARCODE": "INV1", "QTY": 3,
                          "IGST Amount": 1234, "Basic Amt.": 5678})])
    r = parse_grn_register(data)["rows"][0]
    assert "raw" not in r
    assert not any(str(v) == "5678" for v in r.values())
