"""Shared offline fakes for the fetch_* / discover_* scraper tests."""

from __future__ import annotations

import importlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import season


class FakeResponse:
    def __init__(self, body: str | bytes):
        self._body = body.encode("utf-8") if isinstance(body, str) else body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeUrlopen:
    """Stands in for urllib.request.urlopen.

    `routes` maps a URL substring to a body (str/bytes), an exception to raise,
    or a list of those consumed one per call (the last item repeats). The first
    matching key wins, so list more specific keys first.
    """

    def __init__(self, routes: dict):
        self.routes = routes
        self.requests: list[urllib.request.Request] = []

    @property
    def urls(self) -> list[str]:
        return [r.full_url for r in self.requests]

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        for key, value in self.routes.items():
            if key in req.full_url:
                if isinstance(value, list):
                    value = value.pop(0) if len(value) > 1 else value[0]
                if isinstance(value, BaseException):
                    raise value
                return FakeResponse(value)
        raise AssertionError(f"unexpected request: {req.full_url}")


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("http://x", code, "err", {}, None)


def url_error(reason: str = "boom") -> urllib.error.URLError:
    return urllib.error.URLError(reason)


def install_urlopen(monkeypatch, routes: dict) -> FakeUrlopen:
    fake = FakeUrlopen(routes)
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return fake


def no_sleep(monkeypatch) -> list[float]:
    sleeps: list[float] = []
    monkeypatch.setattr("time.sleep", sleeps.append)
    return sleeps


def allow_any_path(monkeypatch, module) -> None:
    """Scripts clamp CLI paths to data/ via safe_path; tests use tmp_path instead."""
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))


def patch_io(monkeypatch, module, routes: dict | None = None):
    """Offline setup for a script's main(): free paths, no sleeping, fake network."""
    allow_any_path(monkeypatch, module)
    sleeps = no_sleep(monkeypatch)
    return install_urlopen(monkeypatch, routes or {}), sleeps


def run_main(monkeypatch, module, *argv: str) -> None:
    monkeypatch.setattr(sys, "argv", [module.__name__ + ".py", *argv])
    module.main()


def load_module(monkeypatch, tmp_path: Path, name: str):
    """Fresh import of a module that resolves the season id at import time,
    without reading the real events_index.json."""
    monkeypatch.setattr(season, "EVENTS_INDEX_PATH", tmp_path / "no_events_index.json")
    monkeypatch.delitem(sys.modules, name, raising=False)
    module = importlib.import_module(name)
    monkeypatch.setitem(sys.modules, name, module)
    return module


def write_json(path: Path, data) -> Path:
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_cookie(tmp_path: Path, value: str = "sess=abc") -> Path:
    path = tmp_path / "cookie.txt"
    path.write_text(f"  {value}\n", encoding="utf-8")
    return path


def header_map(req) -> dict[str, str]:
    """Request headers keyed by lower-cased name (urllib capitalizes them oddly)."""
    return {k.lower(): v for k, v in req.header_items()}
