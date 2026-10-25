from pathlib import Path

import pytest

from helpers_orchestrators import FakeBrowserSession, exit_code, import_with_playwright, read_json, run_main

CARD_PAGE = (
    "<a href='/tournament?id=EE-OUTSIDE'>before card</a>"
    "<h2>Mijn toernooien</h2>"
    "<a href='/tournament?id=abc-123'>one</a><a href='tournament?id=ABC-123'>dup</a><a href='/tournament?id=0f'>two</a>"
    + "x" * 20_000
    + "<a href='/tournament?id=FF-TOO-FAR'>after card</a>"
)


def load(monkeypatch, **session_kwargs):
    session = FakeBrowserSession(**session_kwargs)
    return import_with_playwright(monkeypatch, "get_my_tournaments", session), session


@pytest.mark.parametrize("consent_banner,consent_error", [(True, False), (False, False), (False, True)])
def test_fetch_ids_are_scoped_to_card_deduplicated_and_sorted(monkeypatch, consent_banner, consent_error):
    module, session = load(
        monkeypatch, counts={"button.js-accept-basic": int(consent_banner)}, html=CARD_PAGE, consent_error=consent_error,
    )

    assert module.fetch_my_tournament_ids("user", "secret") == ["0F", "ABC-123"]

    assert session.launch_kwargs == {"headless": True}
    assert session.called("goto") == [("goto", module.LOGIN_URL), ("goto", "https://www.toernooi.nl/tournaments")]
    assert session.called("fill") == [("fill", "#Login", "user"), ("fill", "#Password", "secret")]
    assert session.called("click") == [("click", "#btnLogin")]
    assert bool(session.called("locator.click")) is True  # consent iframe button is always attempted
    assert session.called("close")


def test_fetch_ids_warns_and_returns_empty_when_card_is_missing(monkeypatch, capsys):
    module, _ = load(monkeypatch, html="<p>nothing here tournament?id=AA</p>")
    assert module.fetch_my_tournament_ids("user", "secret", headless=False) == []
    assert "'Mijn toernooien' card not found" in capsys.readouterr().err


def test_fetch_ids_fails_when_login_form_is_still_shown(monkeypatch):
    module, session = load(monkeypatch, counts={"#Password": 1}, html=CARD_PAGE)
    with pytest.raises(SystemExit, match="Login form still present"):
        module.fetch_my_tournament_ids("user", "wrong")
    assert session.called("close") == [("close",)]


@pytest.mark.parametrize("env", [{}, {"TOERNOOI_USERNAME": "user"}, {"TOERNOOI_PASSWORD": "secret"}])
def test_main_requires_both_credentials(monkeypatch, capsys, env):
    module, _ = load(monkeypatch)
    for name in ("TOERNOOI_USERNAME", "TOERNOOI_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))
    assert exit_code(monkeypatch, module) == 1
    assert "TOERNOOI_USERNAME and TOERNOOI_PASSWORD must be set" in capsys.readouterr().err


@pytest.mark.parametrize("flags,headless", [([], True), (["--headed"], False)])
def test_main_saves_ids_as_json(monkeypatch, tmp_path, capsys, flags, headless):
    module, _ = load(monkeypatch)
    calls = []
    monkeypatch.setattr(module, "fetch_my_tournament_ids", lambda u, p, headless: calls.append((u, p, headless)) or ["A", "B"])
    monkeypatch.setenv("TOERNOOI_USERNAME", "user")
    monkeypatch.setenv("TOERNOOI_PASSWORD", "secret")
    monkeypatch.setattr(module, "safe_path", lambda p: Path(p))
    target = tmp_path / "my_tournaments.json"

    run_main(monkeypatch, module, "--save", str(target), *flags)

    assert calls == [("user", "secret", headless)]
    assert read_json(target) == ["A", "B"]
    assert f"Found 2 registered/favorited tournament(s), saved to {target}" in capsys.readouterr().out
