from app.po_number import find_po_number


def test_finds_the_real_format():
    """The format actually printed on HSCVPL's purchase orders."""
    text = "Order No. :  PO/HSM/00000910/26-27\nOrder Date : 22-07-2026"
    assert find_po_number(text) == "PO/HSM/00000910/26-27"


def test_finds_it_without_a_label():
    """Layout varies; the shape alone is distinctive enough."""
    assert find_po_number("something\nPO/HSM/00000911/26-27\n") == "PO/HSM/00000911/26-27"


def test_accepts_other_labels():
    for label in ("PO No:", "P.O. Number -", "Purchase Order No."):
        assert find_po_number(f"{label} PO/HSM/00000912/26-27") == "PO/HSM/00000912/26-27"


def test_uppercases_and_strips_punctuation():
    assert find_po_number("Order No: po/hsm/00000913/26-27.") == "PO/HSM/00000913/26-27"


def test_ignores_a_label_followed_by_a_word():
    """"Order No :" then prose must not be read as an identifier."""
    assert find_po_number("Order No : Pending confirmation from vendor") is None


def test_ignores_bare_digits_after_a_label():
    """A lone number is too weak a signal — it could be anything on the page."""
    assert find_po_number("Order No : 12345") is None


def test_does_not_match_a_gstin_or_hsn():
    """Other identifiers crowd the same header and must not be mistaken."""
    text = "GSTIN :10AACCH9679K2Z7[10 -Bihar]\nHSN Code 59039090\nQTY 3085"
    assert find_po_number(text) is None


def test_returns_none_on_empty_input():
    assert find_po_number("") is None
    assert find_po_number("   ") is None


def test_prefers_the_labelled_number_over_a_later_one():
    text = "Order No : PO/HSM/00000910/26-27\nRef PO/HSM/00000001/25-26"
    assert find_po_number(text) == "PO/HSM/00000910/26-27"
