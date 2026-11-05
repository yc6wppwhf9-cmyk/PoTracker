"""Catalogue entries auto-registered from an RM sheet.

Their category drives buyer routing and their base unit drives every later
conversion, so both must come out right for sheets without a unit column.
"""
from __future__ import annotations

import pytest

from app.routers.rm_sheets import base_department, new_sku_entry, units_by_category


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Matty - Extra", "Matty"),
        ("Aster – extra", "Aster"),
        ("Ully (Extra)", "Ully"),
        ("Matty", "Matty"),
        ("Hard Luggage - Shell", "Hard Luggage - Shell"),
        (None, ""),
    ],
)
def test_base_department(raw, expected):
    assert base_department(raw) == expected


CATALOGUE = {
    "INV1": {"item_code": "INV1", "base_unit": "mtr", "category": "Matty"},
    "INV2": {"item_code": "INV2", "base_unit": "mtr", "category": "Matty"},
    "INV3": {"item_code": "INV3", "base_unit": "kg", "category": "Matty"},
    "INV4": {"item_code": "INV4", "base_unit": "pcs", "category": "Label"},
    "INV5": {"item_code": "INV5", "base_unit": "", "category": "Ully"},
}


def test_units_by_category_takes_the_most_common_unit():
    assert units_by_category(CATALOGUE) == {"matty": "mtr", "label": "pcs"}


def test_new_sku_uses_base_department_and_category_unit():
    entry = new_sku_entry(" INV9 ", "FB PVC Bolt RD", "Matty - Extra", None, units_by_category(CATALOGUE))
    assert entry == {
        "item_code": "INV9",
        "name": "FB PVC Bolt RD",
        "category": "Matty",
        "base_unit": "mtr",
        "moq": 0,
    }


def test_new_sku_prefers_the_sheet_unit_and_falls_back_to_pcs():
    units = units_by_category(CATALOGUE)
    assert new_sku_entry("INV9", None, "Matty", "Kg", units)["base_unit"] == "Kg"
    assert new_sku_entry("INV9", None, "Zips", None, units)["base_unit"] == "pcs"
