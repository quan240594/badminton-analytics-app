from pathlib import Path

import pytest

from helpers_orchestrators import FakeBrowserSession, import_with_playwright, run_main

COOKIES = [{"name": "sid", "value": "abc"}, {"name": "sport", "value": "2"}]


def load(monkeypatch, **session_kwargs):
    session = FakeBrowserSession(**session_kwargs)
    return import_with_playwright(monkeypatch, "get_tournament_search_cookie", session), session


@pytest.mark.parametrize("consent_banner,consent_error", [(True, False), (False, False), (False, True)])
def test_capture_cookie_accepts_consent_and_selects_badminton(monkeypatch, consent_banner, consent_error):
    module, session = load(
        monkeypatch, counts={"button.js-accept-basic": int(consent_banner)}, cookies=COOKIES, consent_error=consent_error,
    )

    assert module.capture_cookie() == "sid=abc; sport=2"

    assert session.launch_kwargs == {"headless": True}
    assert session.called("goto") == [("goto", module.TOURNAMENTS_URL), ("goto", module.SET_SPORT_URL)]
    assert ("locator.click", "button.js-accept-basic") in session.called("locator.click") or not consent_banner
    assert ("locator.click", "div.btn.green") in session.called("locator.click")
    assert session.called("cookies") == [("cookies", (module.TOURNAMENTS_URL,))]
    assert session.called("close")


def test_capture_cookie_runs_headed_when_requested(monkeypatch):
    module, session = load(monkeypatch, cookies=COOKIES)
    module.capture_cookie(headless=False)
    assert session.launch_kwargs == {"headless": False}


def test_capture_cookie_fails_without_cookies(monkeypatch):
    module, _ = load(monkeypatch)
    with pytest.raises(SystemExit, match="No cookies captured"):
        module.capture_cookie()


@pytest.mark.parametrize("flags,headless", [([], True), (["--headed"], False)])
def test_main_saves_cookie_file(monkeypatch, tmp_path, capsys, flags, headless):
    module, session = load(monkeypatch, cookies=COOKIES)
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))
    target = tmp_path / "tournament_cookie.txt"

    run_main(monkeypatch, module, "--save", str(target), *flags)

    assert target.read_text(encoding="utf-8") == "sid=abc; sport=2"
    assert session.launch_kwargs == {"headless": headless}
    assert f"Saved cookie (16 chars) to {target}" in capsys.readouterr().out
