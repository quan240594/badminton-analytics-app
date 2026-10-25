import sys
import urllib.error
from types import SimpleNamespace

import pytest

import scrape_all_pools as sap
from helpers_orchestrators import (
    FIXED_DAY_START,
    STAMP,
    check_current_day_start,
    check_load_daily_budget,
    exit_code,
    fake_clock,
    freeze_datetime,
    isolate_module,
    read_json,
    run_main,
    write_json,
)

PATH_CONSTANTS = ("DRAW_TEAMS_PATH", "FETCHED_POOLS_PATH", "DAILY_BUDGET_PATH")


@pytest.fixture
def env(monkeypatch, tmp_path):
    paths = isolate_module(monkeypatch, sap, tmp_path, *PATH_CONSTANTS)
    freeze_datetime(monkeypatch, sap)
    write_json(paths["DRAW_TEAMS_PATH"], {"10": {"afdelingLabel": "Eredivisie"}, "9": {}, "5": {"afdelingLabel": "Hoofdklasse"}})
    cookie = tmp_path / "cookie.txt"
    cookie.write_text(" sess=1\n", encoding="utf-8")
    state = SimpleNamespace(paths=paths, cookie=cookie, tmp=tmp_path, fetches=[], builds=[], new_count=4, error=None)

    def fake_fetch(draw_id, cookie_text, cookie_file, delay):
        state.fetches.append((draw_id, cookie_text, cookie_file, delay))
        if state.error:
            raise state.error
        return state.new_count

    monkeypatch.setattr(sap, "fetch_pool_players", fake_fetch)
    monkeypatch.setattr(sap, "subprocess", SimpleNamespace(run=lambda cmd, **kw: state.builds.append((cmd, kw))))
    return state


def args(env, *extra):
    return ["--cookie-file", str(env.cookie), *extra]


def test_fetched_pools_roundtrip(env):
    assert sap.load_fetched_pools() == {}
    sap.save_fetched_pools({"5": {"fetchedAt": "x\x00y"}})
    assert sap.load_fetched_pools() == {"5": {"fetchedAt": "xy"}}


def test_current_day_start_boundaries():
    check_current_day_start(sap)


def test_load_daily_budget_resets_on_new_day(monkeypatch, tmp_path):
    check_load_daily_budget(monkeypatch, sap, tmp_path)


def test_save_daily_budget_persists_state(env):
    sap.save_daily_budget({"dayStart": FIXED_DAY_START, "workSeconds": 3.5})
    assert read_json(env.paths["DAILY_BUDGET_PATH"]) == {"dayStart": FIXED_DAY_START, "workSeconds": 3.5}


def test_main_fetches_lowest_pending_pool_and_rebuilds_career(env, monkeypatch, capsys):
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": FIXED_DAY_START, "workSeconds": 60})
    fake_clock(monkeypatch, sap, 100.0, 220.0)

    run_main(monkeypatch, sap, *args(env, "--delay", "0.5"))

    assert env.fetches == [("5", "sess=1", env.cookie, 0.5)]
    assert read_json(env.paths["FETCHED_POOLS_PATH"]) == {"5": {"fetchedAt": STAMP}}
    assert read_json(env.paths["DAILY_BUDGET_PATH"]) == {"dayStart": FIXED_DAY_START, "workSeconds": 180.0}
    assert env.builds == [([sys.executable, "build_career_db.py", "pages", "--out", "career.json"], {"check": True, "cwd": env.tmp})]
    out = capsys.readouterr().out
    assert "Pool 5 (Hoofdklasse)... [0/3 done before this run, 1.0/120 min" in out
    assert "OK: 4 new player(s), took 2.0 min" in out
    assert "1/3 pools done overall (2 remaining), today's budget now at 3.0/120 min" in out


def test_main_falls_back_to_draw_id_when_label_missing(env, monkeypatch, capsys):
    write_json(env.paths["FETCHED_POOLS_PATH"], {"5": {}, "10": {}})
    fake_clock(monkeypatch, sap, 0.0, 1.0)
    run_main(monkeypatch, sap, *args(env))
    assert env.fetches[0][0] == "9"
    assert "Pool 9 (9)..." in capsys.readouterr().out


def test_main_stops_when_daily_budget_is_used_up(env, monkeypatch, capsys):
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": FIXED_DAY_START, "workSeconds": 7200})
    assert exit_code(monkeypatch, sap, *args(env)) == sap.NOTHING_TO_DO
    assert env.fetches == [] and env.builds == []
    out = capsys.readouterr().out
    assert "Daily scrape budget used up (120.0/120 min)" in out
    assert "next reset at 2026-10-03T08:00:00+00:00" in out
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 7200


def test_main_force_ignores_exhausted_budget(env, monkeypatch):
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": FIXED_DAY_START, "workSeconds": 7200})
    fake_clock(monkeypatch, sap, 0.0, 120.0)
    run_main(monkeypatch, sap, *args(env, "--force"))
    assert [f[0] for f in env.fetches] == ["5"]
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 7320


def test_main_resumes_after_day_rollover(env, monkeypatch):
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": "2026-10-01T08:00:00+00:00", "workSeconds": 99999})
    fake_clock(monkeypatch, sap, 0.0, 60.0)
    run_main(monkeypatch, sap, *args(env, "--budget-minutes", "5"))
    assert read_json(env.paths["DAILY_BUDGET_PATH"]) == {"dayStart": FIXED_DAY_START, "workSeconds": 60.0}


def test_main_reports_nothing_left_when_all_pools_fetched(env, monkeypatch, capsys):
    write_json(env.paths["FETCHED_POOLS_PATH"], {"5": {}, "9": {}, "10": {}})
    assert exit_code(monkeypatch, sap, *args(env)) == sap.NOTHING_TO_DO
    assert "All 3 pools already fetched" in capsys.readouterr().out
    assert env.fetches == []


@pytest.mark.parametrize("error", [RuntimeError("boom"), urllib.error.URLError("down"), TimeoutError("slow")])
def test_main_records_work_time_and_exits_1_on_fetch_failure(env, monkeypatch, capsys, error):
    env.error = error
    fake_clock(monkeypatch, sap, 10.0, 130.0)
    assert exit_code(monkeypatch, sap, *args(env)) == 1
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 120.0
    assert not env.paths["FETCHED_POOLS_PATH"].exists()
    assert env.builds == []
    assert "FAILED:" in capsys.readouterr().out
