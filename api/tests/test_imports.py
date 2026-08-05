"""Every module must import cleanly.

A deploy died in production with a SyntaxError in exports.py: an `if` block was
deleted and its `elif` left behind. Nothing caught it — the existing tests cover
parsing only, which imports none of the routers, so the whole suite passed
against code that could not start.

These tests are deliberately dumb. They do not check behaviour; they check that
the process can boot, which is the failure that takes the service down.
"""

from __future__ import annotations

import importlib
import pkgutil

import pytest

import app as app_pkg

MODULES = sorted(
    m.name
    for m in pkgutil.walk_packages(app_pkg.__path__, prefix="app.")
)


@pytest.mark.parametrize("name", MODULES)
def test_module_imports(name: str) -> None:
    """Import each module in the package, including every router."""
    importlib.import_module(name)


def test_app_starts() -> None:
    """The FastAPI app builds and registers its routes."""
    from app.main import app

    paths = {getattr(r, "path", None) for r in app.routes}
    # Sanity, not exhaustive: the health check is what the platform polls.
    assert "/health" in paths
    assert "/" in paths
