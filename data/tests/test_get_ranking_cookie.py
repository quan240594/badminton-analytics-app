from pathlib import Path

import pytest

from helpers_orchestrators import FakeBrowserSession, import_with_playwright, run_main

COOKIES = [{"name": "sid", "value": "abc"}, {"name": "st", "value": "l=1033"}]


def load(monkeypatch, **session_kwargs):
    session = FakeBrowserSession(**session_kwargs)
    return import_with_playwright(monkeypatch, "get_ranking_cookie", session), session


@pytest.mark.parametrize("consent_banner,consent_error", [(True, False), (False, False), (False, True)])
def test_capture_cookie_accepts_consent_and_lands_on_the_ranking_page(monkeypatch, consent_banner, consent_error):
    module, session = load(monkeypatch, counts={"button.js-accept-basic": int(consent_banner)}, cookies=COOKIES, consent_error=consent_error)

    assert module.capture_cookie() == "sid=abc; st=l=1033"

    assert session.launch_kwargs == {"headless": True}
    assert session.called("goto") == [("goto", module.RANKING_URL), ("goto", module.RANKING_URL)]
    assert (("locator.click", "button.js-accept-basic") in session.called("locator.click")) == consent_banner
    assert session.called("cookies") == [("cookies", (module.RANKING_URL,))]
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
    target = tmp_path / "ranking_cookie.txt"

    run_main(monkeypatch, module, "--save", str(target), *flags)

    assert target.read_text(encoding="utf-8") == "sid=abc; st=l=1033"
    assert session.launch_kwargs == {"headless": headless}
    assert f"Saved cookie (18 chars) to {target}" in capsys.readouterr().out
