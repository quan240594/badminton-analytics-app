import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from helpers_orchestrators import exit_code, import_fresh, run_main

BROWSERS = ("chrome", "firefox", "safari", "edge", "brave")


def cookie(name, value):
    return SimpleNamespace(name=name, value=value)


@pytest.fixture
def env(monkeypatch, tmp_path):
    state = SimpleNamespace(jar=[cookie("a", "1"), cookie("b", "2")], error=None, loads=[], tmp=tmp_path)

    def loader_for(browser):
        def loader(domain_name):
            state.loads.append((browser, domain_name))
            if state.error:
                raise state.error
            return state.jar

        return loader

    stub = types.ModuleType("browser_cookie3")
    for browser in BROWSERS:
        setattr(stub, browser, loader_for(browser))
    state.module = import_fresh(monkeypatch, "get_cookie", {"browser_cookie3": stub})
    monkeypatch.setattr(state.module, "safe_path", lambda p: Path(p))
    return state


def test_build_cookie_header_joins_pairs_for_requested_browser(env):
    assert env.module.build_cookie_header("firefox", "example.org") == "a=1; b=2"
    assert env.loads == [("firefox", "example.org")]


def test_build_cookie_header_exits_when_jar_is_empty(env):
    env.jar = []
    with pytest.raises(SystemExit, match="No cookies found for example.org in brave"):
        env.module.build_cookie_header("brave", "example.org")


def test_main_prints_cookie_header_for_default_browser_and_domain(env, monkeypatch, capsys):
    run_main(monkeypatch, env.module)
    assert capsys.readouterr().out == "a=1; b=2\n"
    assert env.loads == [("chrome", env.module.DOMAIN)]


def test_main_saves_cookie_file_with_private_permissions(env, monkeypatch, capsys):
    target = env.tmp / "cookie.txt"
    run_main(monkeypatch, env.module, "--browser", "edge", "--domain", "example.org", "--save", str(target))
    assert target.read_text(encoding="utf-8") == "a=1; b=2"
    assert target.stat().st_mode & 0o777 == 0o600
    assert env.loads == [("edge", "example.org")]
    assert f"Wrote cookie (8 chars) to {target}" in capsys.readouterr().out


def test_main_exits_1_when_browser_backend_fails(env, monkeypatch, capsys):
    env.error = RuntimeError("keychain denied")
    assert exit_code(monkeypatch, env.module) == 1
    assert "Failed to read cookies from chrome: keychain denied" in capsys.readouterr().err


def test_main_exits_with_message_when_no_cookies_found(env, monkeypatch):
    env.jar = []
    assert "No cookies found for" in exit_code(monkeypatch, env.module)


def test_main_rejects_unsupported_browser(env, monkeypatch):
    assert exit_code(monkeypatch, env.module, "--browser", "opera") == 2
