from pathlib import Path

import pytest

from helpers_orchestrators import FakeBrowserSession, exit_code, import_with_playwright, run_main

COOKIES = [{"name": "a", "value": "1"}, {"name": "b", "value": "2"}]
CONSENT = "button.js-accept-basic"


def load(monkeypatch, **session_kwargs):
    session = FakeBrowserSession(**session_kwargs)
    return import_with_playwright(monkeypatch, "playwright_login", session), session


@pytest.mark.parametrize("consent_banner", [True, False])
def test_login_submits_form_and_joins_cookies(monkeypatch, consent_banner):
    module, session = load(monkeypatch, counts={CONSENT: int(consent_banner)}, cookies=COOKIES)

    assert module.login_and_get_cookie("user", "secret") == "a=1; b=2"

    assert session.launch_kwargs == {"headless": True}
    assert session.called("goto") == [("goto", module.LOGIN_URL)]
    assert session.called("fill") == [("fill", "#Login", "user"), ("fill", "#Password", "secret")]
    assert session.called("click") == [("click", "#btnLogin")]
    assert bool(session.called("locator.click")) is consent_banner
    assert bool(session.called("wait_for_timeout")) is consent_banner
    assert session.called("cookies") == [("cookies", (module.LOGIN_URL,))]


def test_login_runs_headed_when_requested(monkeypatch):
    module, session = load(monkeypatch, cookies=COOKIES)
    module.login_and_get_cookie("user", "secret", headless=False)
    assert session.launch_kwargs == {"headless": False}


def test_login_fails_when_form_is_still_shown(monkeypatch):
    module, session = load(monkeypatch, counts={"#Password": 1}, cookies=COOKIES)
    with pytest.raises(SystemExit, match="Login form still present"):
        module.login_and_get_cookie("user", "wrong")
    assert session.called("close") == [("close",)]
    assert session.called("cookies") == []


def test_login_fails_when_no_cookies_were_captured(monkeypatch):
    module, _ = load(monkeypatch)
    with pytest.raises(SystemExit, match="No cookies captured"):
        module.login_and_get_cookie("user", "secret")


@pytest.mark.parametrize("env", [{}, {"TOERNOOI_USERNAME": "user"}, {"TOERNOOI_PASSWORD": "secret"}])
def test_main_requires_both_credentials(monkeypatch, capsys, env):
    module, _ = load(monkeypatch)
    for name in ("TOERNOOI_USERNAME", "TOERNOOI_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))
    assert exit_code(monkeypatch, module, "--save", "cookie.txt") == 1
    assert "TOERNOOI_USERNAME and TOERNOOI_PASSWORD must be set" in capsys.readouterr().err


@pytest.mark.parametrize("flags,headless", [([], True), (["--headed"], False)])
def test_main_saves_cookie_with_private_permissions(monkeypatch, tmp_path, capsys, flags, headless):
    module, session = load(monkeypatch, cookies=COOKIES)
    monkeypatch.setenv("TOERNOOI_USERNAME", "user")
    monkeypatch.setenv("TOERNOOI_PASSWORD", "secret")
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))
    target = tmp_path / "cookie.txt"

    run_main(monkeypatch, module, "--save", str(target), *flags)

    assert target.read_text(encoding="utf-8") == "a=1; b=2"
    assert target.stat().st_mode & 0o777 == 0o600
    assert session.launch_kwargs == {"headless": headless}
    assert f"Wrote cookie (8 chars) to {target}" in capsys.readouterr().out
