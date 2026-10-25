import subprocess
import sys
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import pytest

import refresh_data
from helpers_orchestrators import FIXED_NOW, freeze_datetime, isolate_module, read_json, run_main, write_json

VOLATILE = "0" * 36
OTHER_VOLATILE = "1" * 36
RECENT = "2026-10-01T12:00:00+00:00"
OLD = "2026-09-20T12:00:00+00:00"


@pytest.fixture
def rd(monkeypatch, tmp_path):
    isolate_module(monkeypatch, refresh_data, tmp_path, "CHANGE_STATE_PATH", "PROGRESS_PATH", "LAST_REFRESHED_PATH")
    monkeypatch.setattr(refresh_data, "CURRENT_TOURNAMENT_ID", "T1")
    monkeypatch.setattr(refresh_data, "VENV_PYTHON", tmp_path / ".venv" / "bin" / "python3")
    return refresh_data


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


class FakeProc:
    """poll() runs one queued side effect per call (returning None = still running), then reports returncode."""

    def __init__(self, returncode=0, steps=()):
        self.returncode = returncode
        self.steps = list(steps)

    def poll(self):
        if self.steps:
            self.steps.pop(0)()
            return None
        return self.returncode


def drawmatches_page(viewstate, dropdown, content="score 21-10"):
    return f'<input name="__VIEWSTATE" value="{viewstate}"><select id="tst_{dropdown}">{content}</select>'.encode()


def test_write_progress_defaults(rd):
    rd.write_progress("cookie", 1, "refreshing")
    assert read_json(rd.PROGRESS_PATH) == {
        "step": "cookie", "percent": 1, "detail": "refreshing", "running": True, "error": None, "unchanged": False,
    }


@pytest.mark.parametrize("percent,expected", [(150, 100), (-5, 0), (33.33, 33.3)])
def test_write_progress_clamps_and_rounds(rd, percent, expected):
    rd.write_progress("x", percent)
    assert read_json(rd.PROGRESS_PATH)["percent"] == expected


def test_has_changed_ignores_volatile_tokens_but_detects_content(rd, monkeypatch):
    bodies = iter([
        drawmatches_page("aaa", VOLATILE),
        drawmatches_page("bbb", OTHER_VOLATILE),
        drawmatches_page("bbb", OTHER_VOLATILE, content="score 21-12"),
    ])
    seen = []

    def fake_urlopen(req, timeout):
        seen.append((req, timeout))
        return FakeResponse(next(bodies))

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    assert rd.has_changed("sess=1") is True  # first run: no previous hash
    assert rd.has_changed("sess=1") is False  # only per-request tokens differ
    assert rd.has_changed("sess=1") is True  # real content changed
    request, timeout = seen[0]
    assert request.full_url.endswith("drawmatches.aspx?id=T1&draw=135")
    assert request.get_header("Cookie") == "sess=1"
    assert timeout == 20
    assert read_json(rd.CHANGE_STATE_PATH)["drawId"] == "135"


def test_run_echoes_and_executes_in_data_dir(rd, monkeypatch, tmp_path, capsys):
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: calls.append((cmd, kw)))
    rd.run("python", "script.py")
    assert calls == [(("python", "script.py"), {"check": True, "cwd": tmp_path})]
    assert capsys.readouterr().out == "$ python script.py\n"


@pytest.mark.parametrize("expected_count", [2, 0])
def test_run_with_progress_reports_file_counts(rd, monkeypatch, tmp_path, expected_count):
    paths = [tmp_path / f"page{i}.html" for i in range(expected_count)]
    snapshots = []
    steps = [lambda: None] + [p.touch for p in paths]
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, cwd: FakeProc(0, steps))
    monkeypatch.setattr(rd, "time", SimpleNamespace(sleep=lambda s: snapshots.append(read_json(rd.PROGRESS_PATH))))

    rd.run_with_progress(["fetch"], paths, "events", 10, 40)

    target = expected_count or 1
    assert snapshots[0]["detail"] == f"0/{target}"
    assert [s["percent"] for s in snapshots] == sorted(s["percent"] for s in snapshots)
    final = read_json(rd.PROGRESS_PATH)
    assert (final["step"], final["percent"], final["detail"]) == ("events", 50, f"{target}/{target}")


def test_run_with_progress_raises_when_process_fails(rd, monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, cwd: FakeProc(returncode=2))
    with pytest.raises(subprocess.CalledProcessError) as exc:
        rd.run_with_progress(["fetch"], [], "events", 10, 40)
    assert exc.value.returncode == 2


def test_last_refreshed_roundtrip_is_sanitized(rd):
    assert rd.load_last_refreshed() == {}
    rd.save_last_refreshed({"k": "a\x00b"})
    assert rd.load_last_refreshed() == {"k": "ab"}


@pytest.mark.parametrize("state,expected", [({}, True), ({"k": RECENT}, False), ({"k": OLD}, True)])
def test_is_stale(rd, state, expected):
    assert rd.is_stale(state, "k", 3, FIXED_NOW) is expected


@pytest.mark.parametrize("venv_exists,browser,python,expected_browser", [
    (True, "firefox", "venv", "firefox"),
    (False, "opera", "system", "chrome"),
])
def test_refresh_cookie_builds_safe_command(rd, monkeypatch, venv_exists, browser, python, expected_browser):
    if venv_exists:
        rd.VENV_PYTHON.parent.mkdir(parents=True)
        rd.VENV_PYTHON.write_text("")
    calls = []
    monkeypatch.setattr(rd, "run", lambda *cmd: calls.append(cmd))
    rd.refresh_cookie(Path("cookie.txt"), browser)
    interpreter = str(rd.VENV_PYTHON) if python == "venv" else sys.executable
    assert calls == [(interpreter, "get_cookie.py", "--browser", expected_browser, "--save", "cookie.txt")]


def test_refresh_cookie_falls_back_when_command_fails(rd, monkeypatch, capsys):
    def failing_run(*cmd):
        raise subprocess.CalledProcessError(1, cmd)

    monkeypatch.setattr(rd, "run", failing_run)
    rd.refresh_cookie(Path("cookie.txt"), "chrome")
    assert "could not refresh cookie from chrome" in capsys.readouterr().err


@pytest.fixture
def env(rd, monkeypatch, tmp_path):
    """Everything main() touches, with network/subprocess boundaries replaced by recorders."""
    events = [
        {"tournament_id": "T1", "player_id": "p1"},
        {"tournament_id": "T1", "player_id": "p2"},
        {"tournament_id": "OTHER", "player_id": "p3"},
    ]
    write_json(tmp_path / "events_index.json", events)
    write_json(rd.LAST_REFRESHED_PATH, {"event:T1:p2": RECENT, "ranking:2": RECENT, "unrelated": OLD})
    (tmp_path / "cookie.txt").write_text(" sess=1\n", encoding="utf-8")
    events_dir = tmp_path / "pages" / "events"
    rankings_dir = tmp_path / "pages" / "rankings"
    events_dir.mkdir(parents=True)
    rankings_dir.mkdir(parents=True)
    for page in (events_dir / "T1_p1.html", events_dir / "T1_p2.html", rankings_dir / "player_1.html",
                 rankings_dir / "player_2.html", rankings_dir / "category_491.html", tmp_path / "career.state.json"):
        page.write_text("cached", encoding="utf-8")

    state = SimpleNamespace(
        changed=True, fail=None, cookie_refreshes=[], checked_cookies=[], runs=[], progress_runs=[],
        filtered_index=None, tmp=tmp_path,
    )

    def fake_run_with_progress(cmd, expected_paths, step, base, span):
        state.progress_runs.append((cmd, expected_paths, step, base, span))
        if step == "events":
            state.filtered_index = read_json(tmp_path / "events_index.current.json")
        if state.fail:
            raise state.fail

    monkeypatch.setattr(rd, "refresh_cookie", lambda cookie_file, browser: state.cookie_refreshes.append((cookie_file, browser)))
    monkeypatch.setattr(rd, "has_changed", lambda cookie: state.checked_cookies.append(cookie) or state.changed)
    monkeypatch.setattr(rd, "discover_ranking_links", lambda pages_dir: ["1", "2"])
    monkeypatch.setattr(rd, "run_with_progress", fake_run_with_progress)
    monkeypatch.setattr(rd, "run", lambda *cmd: state.runs.append(cmd))
    freeze_datetime(monkeypatch, rd)
    return state


def main_args(env, *extra):
    return ["--cookie-file", str(env.tmp / "cookie.txt"), *extra]


def test_main_skips_fetch_when_nothing_changed(rd, env, monkeypatch, capsys):
    env.changed = False
    run_main(monkeypatch, rd, *main_args(env, "--skip-cookie-refresh"))
    assert env.cookie_refreshes == []
    assert env.checked_cookies == ["sess=1"]
    assert env.progress_runs == [] and env.runs == []
    assert read_json(rd.PROGRESS_PATH) == {
        "step": "done", "percent": 100, "detail": "Data already updated.", "running": False, "error": None, "unchanged": True,
    }
    assert "no changes detected" in capsys.readouterr().out


def test_main_refreshes_only_stale_pages_and_rebuilds(rd, env, monkeypatch):
    run_main(monkeypatch, rd, *main_args(env, "--browser", "firefox", "--min-refresh-days", "3"))

    assert env.cookie_refreshes == [(env.tmp / "cookie.txt", "firefox")]
    assert env.filtered_index == [{"tournament_id": "T1", "player_id": "p1"}]
    assert not (env.tmp / "pages" / "events" / "T1_p1.html").exists()
    assert (env.tmp / "pages" / "events" / "T1_p2.html").exists()
    assert not (env.tmp / "pages" / "rankings" / "player_1.html").exists()
    assert (env.tmp / "pages" / "rankings" / "player_2.html").exists()
    assert not (env.tmp / "pages" / "rankings" / "category_491.html").exists()
    assert not (env.tmp / "career.state.json").exists()
    assert not (env.tmp / "events_index.current.json").exists()

    (events_cmd, events_paths, *events_rest), (rankings_cmd, rankings_paths, *rankings_rest) = env.progress_runs
    assert events_cmd[:3] == [sys.executable, "fetch_events.py", str(env.tmp / "events_index.current.json")]
    assert events_paths == [env.tmp / "pages" / "events" / "T1_p1.html"]
    assert events_rest == ["events", 3, 47]
    assert rankings_cmd[1] == "fetch_rankings.py"
    assert rankings_paths == [env.tmp / "pages" / "rankings" / name for name in
                              ("player_1.html", "category_491.html", "category_493.html", "category_495.html")]
    assert rankings_rest == ["rankings", 50, 45]

    assert read_json(rd.LAST_REFRESHED_PATH) == {
        "event:T1:p1": FIXED_NOW.isoformat(),
        "event:T1:p2": RECENT,
        "ranking:1": FIXED_NOW.isoformat(),
        "ranking:2": RECENT,
        "unrelated": OLD,
    }
    assert env.runs == [
        (sys.executable, "build_career_db.py", "pages", "--out", "career.json"),
        (sys.executable, "parse_rankings.py"),
    ]
    assert read_json(rd.PROGRESS_PATH)["step"] == "done"
    assert read_json(rd.PROGRESS_PATH)["running"] is False


def test_main_reports_failure_and_cleans_up(rd, env, monkeypatch):
    env.fail = RuntimeError("boom")
    with pytest.raises(RuntimeError, match="boom"):
        run_main(monkeypatch, rd, *main_args(env, "--skip-cookie-refresh"))
    progress = read_json(rd.PROGRESS_PATH)
    assert (progress["step"], progress["error"], progress["running"]) == ("error", "boom", False)
    assert not (env.tmp / "events_index.current.json").exists()
    assert "event:T1:p1" not in read_json(rd.LAST_REFRESHED_PATH)
    assert env.runs == []

