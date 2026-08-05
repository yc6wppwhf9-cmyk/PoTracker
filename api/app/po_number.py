"""Find the supplier-facing PO number inside an attached PO document.

The number printed on the document (e.g. ``PO/HSM/00000910/26-27``) is the only
identifier shared with the outside world: it is what appears on the supplier's
invoice and on the GRN register, so it is the key any goods-received matching
has to join on. The database's own uuid means nothing to anyone outside this
system.

Extraction is a convenience, never an authority — the PO team can always
correct it, and a wrong number here would silently misdirect GRN matching
later. Everything below is therefore conservative: it would rather return
nothing than guess.
"""

from __future__ import annotations

import re

# The label as printed on the document, followed by an optional colon.
# Kept broad because "Order No.", "PO No" and "P.O. Number" all occur.
_LABELS = (
    r"(?:order\s*no\.?|order\s*number|po\s*no\.?|p\.?o\.?\s*number|"
    r"purchase\s*order\s*(?:no\.?|number)?)"
)

# A PO number as issued: at least one slash or dash, no spaces, and long enough
# not to match a stray word. Deliberately excludes bare digits — a lone number
# beside "Order No." is too weak a signal to trust.
_TOKEN = r"[A-Z0-9][A-Z0-9/\-]{5,}"

_LABELLED = re.compile(rf"{_LABELS}\s*[:\-]?\s*({_TOKEN})", re.IGNORECASE)

# Fallback: a token that looks unmistakably like a PO number even unlabelled,
# such as PO/HSM/00000910/26-27 — starts with PO and has two or more segments.
_PO_SHAPED = re.compile(r"\bP\.?O\.?[/\-][A-Z0-9][A-Z0-9/\-]{4,}", re.IGNORECASE)


def _clean(value: str) -> str:
    # Trailing punctuation survives the split when the number ends a sentence.
    return value.strip().strip(".,;:").upper()


def find_po_number(text: str) -> str | None:
    """Return the PO number in ``text``, or None if none is clearly present."""
    if not text:
        return None

    m = _LABELLED.search(text)
    if m:
        candidate = _clean(m.group(1))
        # A labelled match still has to look like an identifier rather than the
        # next word on the line.
        if any(c.isdigit() for c in candidate):
            return candidate

    m = _PO_SHAPED.search(text)
    if m:
        return _clean(m.group(0))

    return None


def extract_pdf_text(data: bytes, max_pages: int = 3) -> str:
    """Text of the first pages of a PDF, or "" if it cannot be read.

    Only the first pages are read: the PO number appears in the header, and a
    long document would otherwise be parsed in full for nothing. A failure here
    is never fatal — the document is still attached, and the number can be
    typed in.
    """
    try:
        import io

        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages[:max_pages]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(parts)
    except Exception:
        return ""


def po_number_from_pdf(data: bytes) -> str | None:
    """Convenience wrapper: read a PDF's text and find its PO number."""
    return find_po_number(extract_pdf_text(data))
