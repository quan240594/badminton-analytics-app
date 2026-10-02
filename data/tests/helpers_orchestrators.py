"""Shared fakes/helpers for the orchestrator, cookie and browser-automation script tests."""

import importlib
import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

import pytest

FIXED_NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
STAMP = "2026-10-02T12:00:00Z"
FIXED_DAY_START = "2026-10-02T08:00:00+00:00"

# (now, day_start_hour, expected day boundary) for the shared "daily budget" window logic.
DAY_START_CASES = [
    (datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc), 8, datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc)),
    (datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc), 8, datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc)),
    (datetime(2026, 10, 2, 3, 30, 15, tzinfo=timezone.utc), 8, datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)),
]


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def isolate_module(monkeypatch, module, tmp_path: Path, *path_constants: str) -> dict:
    """Redirects the module's path constants (and DATA_DIR / safe_path) into tmp_path so tests never touch real data files."""
    paths = {}
    for name in path_constants:
        paths[name] = tmp_path / getattr(module, name).name
        monkeypatch.setattr(module, name, paths[name])
    if hasattr(module, "DATA_DIR"):
        monkeypatch.setattr(module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))
    return paths


def freeze_datetime(monkeypatch, module, fixed: datetime = FIXED_NOW) -> None:
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed

    monkeypatch.setattr(module, "datetime", FrozenDatetime)


def fake_clock(monkeypatch, module, *ticks: float):
    """Replaces module.time with a deterministic clock: monotonic() yields ticks in order; sleep() is recorded, not slept."""
    remaining = iter(ticks)
    sleeps = []
    clock = types.SimpleNamespace(
        monotonic=lambda: next(remaining),
        sleep=sleeps.append,
        strftime=lambda fmt, t: STAMP,
        gmtime=lambda: None,
    )
    monkeypatch.setattr(module, "time", clock)
    return sleeps


def run_main(monkeypatch, module, *argv: str) -> None:
    monkeypatch.setattr(sys, "argv", [module.__name__, *argv])
    module.main()


def exit_code(monkeypatch, module, *argv: str):
    with pytest.raises(SystemExit) as exc:
        run_main(monkeypatch, module, *argv)
    return exc.value.code


def import_fresh(monkeypatch, name: str, stubs: dict):
    """Imports `name` anew with `stubs` (module name -> module) installed; sys.modules is restored on teardown."""
    for stub_name, stub in stubs.items():
        monkeypatch.setitem(sys.modules, stub_name, stub)
    monkeypatch.setitem(sys.modules, name, None)
    del sys.modules[name]
    return importlib.import_module(name)


def check_current_day_start(module):
    for now, hour, expected in DAY_START_CASES:
        assert module.current_day_start(now, hour) == expected


def check_load_daily_budget(monkeypatch, module, tmp_path):
    path = isolate_module(monkeypatch, module, tmp_path, "DAILY_BUDGET_PATH")["DAILY_BUDGET_PATH"]
    fresh = {"dayStart": FIXED_DAY_START, "workSeconds": 0.0}
    assert module.load_daily_budget(FIXED_NOW, 8) == fresh  # no file yet

    write_json(path, {"dayStart": FIXED_DAY_START, "workSeconds": 42.5})
    assert module.load_daily_budget(FIXED_NOW, 8) == {"dayStart": FIXED_DAY_START, "workSeconds": 42.5}  # same day: kept

    write_json(path, {"dayStart": "2026-10-01T08:00:00+00:00", "workSeconds": 999})
    assert module.load_daily_budget(FIXED_NOW, 8) == fresh  # new day: reset


class FakeLocator:
    def __init__(self, session, selector):
        self.session = session
        self.selector = selector

    def count(self):
        return self.session.counts.get(self.selector, 0)

    @property
    def first(self):
        return self

    def click(self, **kwargs):
        self.session.calls.append(("locator.click", self.selector))
        if self.session.consent_error and self.selector == "div.btn.green":
            raise TimeoutError("no consent iframe")


class FakeBrowserSession:
    """One object standing in for sync_playwright() -> playwright -> browser -> context -> page."""

    def __init__(self, *, counts=None, html="", cookies=None, consent_error=False):
        self.counts = counts or {}
        self.html = html
        self.cookie_list = cookies or []
        self.consent_error = consent_error
        self.calls = []
        self.launch_kwargs = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def chromium(self):
        return self

    def launch(self, **kwargs):
        self.launch_kwargs = kwargs
        return self

    def new_context(self):
        return self

    def new_page(self):
        return self

    def locator(self, selector):
        return FakeLocator(self, selector)

    def frame_locator(self, selector):
        return self

    def goto(self, url, **kwargs):
        self.calls.append(("goto", url))

    def fill(self, selector, value):
        self.calls.append(("fill", selector, value))

    def click(self, selector):
        self.calls.append(("click", selector))

    def wait_for_load_state(self, state, **kwargs):
        self.calls.append(("wait_for_load_state", state))

    def wait_for_timeout(self, ms):
        self.calls.append(("wait_for_timeout", ms))

    def content(self):
        return self.html

    def cookies(self, urls=None):
        self.calls.append(("cookies", tuple(urls or ())))
        return self.cookie_list

    def close(self):
        self.calls.append(("close",))

    def called(self, name):
        return [c for c in self.calls if c[0] == name]


def import_with_playwright(monkeypatch, name: str, session: FakeBrowserSession):
    api = types.ModuleType("playwright.sync_api")
    api.sync_playwright = lambda: session
    package = types.ModuleType("playwright")
    package.sync_api = api
    return import_fresh(monkeypatch, name, {"playwright": package, "playwright.sync_api": api})
