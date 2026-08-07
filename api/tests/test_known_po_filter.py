"""Only receipts against a purchase order raised here are stored.

The emailed register is company-wide: it carries every goods receipt Ginesys
records, most of them against orders this system never saw. Keeping all of it
made the GRN register a second copy of the ERP's data that nobody here can act
on, and buried the handful of lines that do matter.
"""

from app.routers.grn import _rows_for_known_pos


class _Result:
    def __init__(self, data):
        self.data = data


class _Table:
    """Enough of the query builder for the one call under test."""

    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    @property
    def not_(self):
        return self

    def is_(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def execute(self):
        return _Result(self._rows)


class _Client:
    def __init__(self, po_numbers):
        self._rows = [{"po_number": n} for n in po_numbers]

    def table(self, _name):
        return _Table(self._rows)


class _User:
    def __init__(self, po_numbers):
        self.client = _Client(po_numbers)
        self.id = "u1"


OURS = "PO/HSM/00000910/26-27"
THEIRS = "PO/OTHER/00000001/26-27"


def _rows(*numbers):
    return [{"grc_no": f"G{i}", "po_number": n, "qty": 1} for i, n in enumerate(numbers)]


def test_keeps_only_our_purchase_orders():
    kept = _rows_for_known_pos(_User([OURS]), _rows(OURS, THEIRS, OURS))
    assert [r["po_number"] for r in kept] == [OURS, OURS]


def test_drops_a_line_with_no_po_number():
    """Without one it can never be tied to an order, so it would sit in the
    register forever as a row nobody can reconcile."""
    kept = _rows_for_known_pos(_User([OURS]), _rows(OURS, None, ""))
    assert [r["po_number"] for r in kept] == [OURS]


def test_matching_ignores_case_and_surrounding_space():
    """The register and the PO document are typed by different systems."""
    kept = _rows_for_known_pos(
        _User([OURS]), _rows(f"  {OURS.lower()}  ")
    )
    assert len(kept) == 1


def test_nothing_is_kept_when_no_po_number_has_been_captured():
    """Not a crash, and not everything: an empty result is correct here, and
    the import reports how many lines it ignored."""
    assert _rows_for_known_pos(_User([]), _rows(OURS, THEIRS)) == []


def test_an_empty_register_is_handled():
    assert _rows_for_known_pos(_User([OURS]), []) == []
