import re
import subprocess
import sys

import pytest

from helpers_fetchers import load_module, read_json, run_main, write_cookie, write_json


@pytest.fixture
def pool(monkeypatch, tmp_path):
    load_module(monkeypatch, tmp_path, "pool_fetch_core")
    module = load_module(monkeypatch, tmp_path, "fetch_pool")
    monkeypatch.setattr(module, "PROGRESS_PATH", tmp_path / "progress.json")
    monkeypatch.setattr(module, "FETCHED_POOLS_PATH", tmp_path / "fetched.json")
    monkeypatch.setattr(module, "safe_path", lambda p: p)
    module.calls = {"fetch": [], "run": []}

    def fake_fetch(draw_id, cookie, cookie_file, delay, progress):
        module.calls["fetch"].append((draw_id, cookie, cookie_file, delay, progress))
        return 3

    monkeypatch.setattr(module, "fetch_pool_players", fake_fetch)
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: module.calls["run"].append((cmd, kw)))
    return module


def run(monkeypatch, pool, tmp_path, draw_id="12"):
    cookie = write_cookie(tmp_path)
    run_main(monkeypatch, pool, "--draw-id", draw_id, "--cookie-file", str(cookie), "--delay", "0.5")
    return cookie


@pytest.mark.parametrize("percent, expected", [(150, 100), (-5, 0), (33.333, 33.3)])
def test_write_progress_clamps_percent(pool, tmp_path, percent, expected):
    pool.write_progress("step", percent, "d")
    assert read_json(tmp_path / "progress.json") == {"step": "step", "percent": expected, "detail": "d", "running": True, "error": None}


def test_main_success_rebuilds_career_and_records_pool(monkeypatch, pool, tmp_path, capsys):
    write_json(tmp_path / "fetched.json", {"7": {"fetchedAt": "old"}})
    cookie = run(monkeypatch, pool, tmp_path, draw_id="012")
    assert pool.calls["fetch"] == [("12", "sess=abc", cookie, 0.5, pool.write_progress)]
    cmd, kwargs = pool.calls["run"][0]
    assert cmd == [sys.executable, "build_career_db.py", "pages", "--out", "career.json"]
    assert kwargs == {"check": True, "cwd": pool.DATA_DIR}
    fetched = read_json(tmp_path / "fetched.json")
    assert fetched["7"] == {"fetchedAt": "old"}
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", fetched["12"]["fetchedAt"])
    progress = read_json(tmp_path / "progress.json")
    assert progress["step"] == "done" and progress["running"] is False and progress["detail"] == "fetched 3 new players"
    assert "pool fetch complete" in capsys.readouterr().out


def test_main_creates_fetched_pools_file_when_missing(monkeypatch, pool, tmp_path):
    run(monkeypatch, pool, tmp_path)
    assert list(read_json(tmp_path / "fetched.json")) == ["12"]


def test_main_records_error_and_reraises(monkeypatch, pool, tmp_path):
    def boom(*args):
        raise RuntimeError("no matches found for this draw")

    monkeypatch.setattr(pool, "fetch_pool_players", boom)
    with pytest.raises(RuntimeError, match="no matches"):
        run(monkeypatch, pool, tmp_path)
    progress = read_json(tmp_path / "progress.json")
    assert progress["step"] == "error" and progress["error"] == "no matches found for this draw" and progress["running"] is False
    assert not (tmp_path / "fetched.json").exists()


def test_main_rejects_non_numeric_draw_id(monkeypatch, pool, tmp_path):
    with pytest.raises(ValueError):
        run(monkeypatch, pool, tmp_path, draw_id="1; rm -rf")
    assert pool.calls["fetch"] == []
