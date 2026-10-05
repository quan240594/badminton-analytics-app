from types import SimpleNamespace

import pytest

import scrape_all_tournaments as sat
from helpers_orchestrators import (
    FIXED_DAY_START,
    FIXED_NOW,
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

PATH_CONSTANTS = (
    "TOURNAMENTS_PATH", "FETCHED_TOURNAMENTS_PATH", "DAILY_BUDGET_PATH", "DETAILS_PATH", "MY_TOURNAMENTS_PATH", "FETCH_ERRORS_PATH",
)
DETAILS = {"events": [1], "draws": [1, 2], "entries": [1, 2, 3]}


@pytest.fixture
def env(monkeypatch, tmp_path):
    paths = isolate_module(monkeypatch, sat, tmp_path, *PATH_CONSTANTS)
    freeze_datetime(monkeypatch, sat)
    cookie = tmp_path / "cookie.txt"
    cookie.write_text(" sess=1\n", encoding="utf-8")
    tournament_cookie = tmp_path / "tournament_cookie.txt"
    tournament_cookie.write_text(" tsess=2\n", encoding="utf-8")
    state = SimpleNamespace(
        paths=paths, cookie=cookie, tournament_cookie=tournament_cookie, discoveries=[], fetches=[], error=None,
        tournaments={"a": {"name": "Alpha"}, "b": {"name": "Beta"}, "c": {}},
    )

    def fake_discover(cookie_text, start_date, end_date, delay):
        state.discoveries.append((cookie_text, start_date, end_date, delay))
        return state.tournaments

    def fake_details(tournament_id, cookie_text):
        state.fetches.append((tournament_id, cookie_text))
        if state.error:
            raise state.error
        return DETAILS

    monkeypatch.setattr(sat, "discover", fake_discover)
    monkeypatch.setattr(sat, "fetch_tournament_details", fake_details)
    return state


def args(env, *extra):
    return ["--cookie-file", str(env.cookie), "--tournament-cookie-file", str(env.tournament_cookie), *extra]


def test_json_helpers_roundtrip(tmp_path):
    path = tmp_path / "x.json"
    assert sat.load_json(path, {"default": True}) == {"default": True}
    sat.save_json(path, {"naam": "Zoë"})
    assert "Zoë" in path.read_text(encoding="utf-8")
    assert sat.load_json(path, None) == {"naam": "Zoë"}


def test_current_day_start_boundaries():
    check_current_day_start(sat)


def test_load_daily_budget_resets_on_new_day(monkeypatch, tmp_path):
    check_load_daily_budget(monkeypatch, sat, tmp_path)


def test_refresh_inventory_discovers_window_around_today_and_saves(env):
    result = sat.refresh_inventory(env.tournament_cookie, 30, 365, 0.7)
    assert result == env.tournaments
    assert env.discoveries == [("tsess=2", "2026-09-02", "2027-10-02", 0.7)]
    assert read_json(env.paths["TOURNAMENTS_PATH"]) == env.tournaments


def test_main_success_records_details_and_clears_previous_errors(env, monkeypatch, capsys):
    env.tournaments = {"a": {"name": "Alpha"}}
    write_json(env.paths["FETCH_ERRORS_PATH"], {"a": {"count": 2, "lastError": "old"}})
    write_json(env.paths["DETAILS_PATH"], {"zzz": {"events": []}})
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": FIXED_DAY_START, "workSeconds": 60})
    fake_clock(monkeypatch, sat, 5.0, 125.0)

    run_main(monkeypatch, sat, *args(env, "--days-back", "10", "--days-forward", "20", "--delay", "0.1"))

    assert env.discoveries == [("tsess=2", "2026-09-22", "2026-10-22", 0.1)]
    assert env.fetches == [("a", "sess=1")]
    assert read_json(env.paths["FETCH_ERRORS_PATH"]) == {}
    assert read_json(env.paths["DETAILS_PATH"]) == {"zzz": {"events": []}, "a": DETAILS}
    assert read_json(env.paths["FETCHED_TOURNAMENTS_PATH"]) == {"a": {"fetchedAt": STAMP, "schema": sat.FETCH_SCHEMA}}
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 180.0
    out = capsys.readouterr().out
    assert "Tournament a (Alpha)... [0/1 done before this run" in out
    assert "OK: 1 events, 2 draws, 3 entries, took 2.0 min" in out
    assert "1/1 tournaments done overall (0 remaining), today's budget now at 3.0/30 min" in out


@pytest.mark.parametrize("mine,errors,expected_first", [
    ([], {}, "a"),
    ([], {"a": {"count": 1}}, "b"),
    ([], {"a": {"count": 0}}, "a"),
    (["b"], {}, "b"),
    (["c"], {"c": {"count": 1}}, "a"),
    (["c"], {"a": {"count": 1}}, "c"),
])
def test_main_orders_pending_by_failures_then_priority_then_id(env, monkeypatch, mine, errors, expected_first):
    write_json(env.paths["MY_TOURNAMENTS_PATH"], mine)
    write_json(env.paths["FETCH_ERRORS_PATH"], errors)
    fake_clock(monkeypatch, sat, 0.0, 1.0)
    run_main(monkeypatch, sat, *args(env))
    assert env.fetches[0][0] == expected_first


def test_main_labels_priority_tournament_with_id_when_unnamed(env, monkeypatch, capsys):
    write_json(env.paths["MY_TOURNAMENTS_PATH"], ["c"])
    fake_clock(monkeypatch, sat, 0.0, 1.0)
    run_main(monkeypatch, sat, *args(env))
    assert "Tournament c (c) (priority: your tournament)..." in capsys.readouterr().out


def test_main_still_retries_failing_tournament_when_nothing_else_is_left(env, monkeypatch):
    env.tournaments = {"a": {}}
    write_json(env.paths["FETCH_ERRORS_PATH"], {"a": {"count": 9}})
    fake_clock(monkeypatch, sat, 0.0, 1.0)
    run_main(monkeypatch, sat, *args(env))
    assert env.fetches == [("a", "sess=1")]


@pytest.mark.parametrize("error,previous,expected_count", [
    (RuntimeError("boom"), {}, 1),
    (OSError("timeout"), {"a": {"count": 2}}, 3),
])
def test_main_records_failure_and_exits_1(env, monkeypatch, capsys, error, previous, expected_count):
    env.tournaments = {"a": {}}
    env.error = error
    write_json(env.paths["FETCH_ERRORS_PATH"], previous)
    fake_clock(monkeypatch, sat, 10.0, 70.0)

    assert exit_code(monkeypatch, sat, *args(env)) == 1

    entry = read_json(env.paths["FETCH_ERRORS_PATH"])["a"]
    assert entry == {"count": expected_count, "lastError": str(error), "lastAttempt": STAMP}
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 60.0
    assert not env.paths["FETCHED_TOURNAMENTS_PATH"].exists()
    assert f"FAILED (attempt {expected_count} for this tournament)" in capsys.readouterr().out


def test_main_stops_before_discovery_when_budget_used_up(env, monkeypatch, capsys):
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": FIXED_DAY_START, "workSeconds": 1800})
    assert exit_code(monkeypatch, sat, *args(env)) == sat.NOTHING_TO_DO
    assert env.discoveries == [] and env.fetches == []
    out = capsys.readouterr().out
    assert "Daily tournament-scrape budget used up (30.0/30 min)" in out
    assert "next reset at 2026-10-03T08:00:00+00:00" in out
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 1800


def test_main_force_ignores_exhausted_budget(env, monkeypatch):
    write_json(env.paths["DAILY_BUDGET_PATH"], {"dayStart": FIXED_DAY_START, "workSeconds": 1800})
    fake_clock(monkeypatch, sat, 0.0, 30.0)
    run_main(monkeypatch, sat, *args(env, "--force"))
    assert [f[0] for f in env.fetches] == ["a"]
    assert read_json(env.paths["DAILY_BUDGET_PATH"])["workSeconds"] == 1830


def test_main_reports_nothing_left_when_all_tournaments_fetched(env, monkeypatch, capsys):
    write_json(env.paths["FETCHED_TOURNAMENTS_PATH"], {k: {"schema": sat.FETCH_SCHEMA} for k in "abc"})
    assert exit_code(monkeypatch, sat, *args(env)) == sat.NOTHING_TO_DO
    assert "All 3 known tournaments already fetched" in capsys.readouterr().out
    assert env.fetches == []


OLD = "2026-10-01T08:00:00Z"  # 28h before the frozen clock
RECENT = "2026-10-02T06:00:00Z"  # 6h before the frozen clock
CURRENT = sat.FETCH_SCHEMA


@pytest.mark.parametrize("tournament,fetched_entry,due", [
    ({"dates": ["2026-12-06 00:00"]}, {"fetchedAt": OLD, "schema": CURRENT}, True),
    ({"dates": ["2026-12-06 00:00"]}, {"fetchedAt": RECENT, "schema": CURRENT}, False),
    ({"dates": ["2026-09-20 00:00", "2026-09-21 23:59"]}, {"fetchedAt": OLD}, False),  # already over
    ({"dates": ["2026-10-02 00:00"]}, {"fetchedAt": OLD, "schema": CURRENT}, True),  # happening today
    ({}, {"fetchedAt": OLD, "schema": CURRENT}, True),  # no dates known: keep refreshing
    ({"dates": ["2026-12-06 00:00"]}, {"schema": CURRENT}, False),  # no timestamp: leave alone
    ({"dates": ["2026-12-06 00:00"]}, {"fetchedAt": "garbage", "schema": CURRENT}, False),
    ({"dates": ["2026-12-06 00:00"]}, {"fetchedAt": RECENT}, True),  # fetched before the current schema, even if recent
    ({"dates": ["2026-12-06 00:00"]}, {"fetchedAt": RECENT, "schema": CURRENT - 1}, True),
    ({"dates": ["2026-09-20 00:00"]}, {"fetchedAt": RECENT}, False),  # old schema but already over: nothing to gain
])
def test_is_refresh_due(tournament, fetched_entry, due):
    assert sat.is_refresh_due(tournament, fetched_entry, FIXED_NOW) is due


def test_main_refetches_a_stale_tournament_and_updates_its_timestamp(env, monkeypatch):
    env.tournaments = {"a": {"name": "Alpha", "dates": ["2026-12-06 00:00"]}}
    write_json(env.paths["FETCHED_TOURNAMENTS_PATH"], {"a": {"fetchedAt": OLD, "schema": CURRENT}})
    fake_clock(monkeypatch, sat, 0.0, 1.0)
    run_main(monkeypatch, sat, *args(env))
    assert env.fetches == [("a", "sess=1")]
    assert read_json(env.paths["FETCHED_TOURNAMENTS_PATH"]) == {"a": {"fetchedAt": STAMP, "schema": sat.FETCH_SCHEMA}}


def test_main_leaves_fresh_and_finished_tournaments_alone(env, monkeypatch):
    env.tournaments = {"a": {"dates": ["2026-12-06 00:00"]}, "b": {"dates": ["2026-09-20 00:00"]}}
    write_json(env.paths["FETCHED_TOURNAMENTS_PATH"], {"a": {"fetchedAt": RECENT, "schema": CURRENT}, "b": {"fetchedAt": OLD, "schema": CURRENT}})
    assert exit_code(monkeypatch, sat, *args(env)) == sat.NOTHING_TO_DO
    assert env.fetches == []


def test_main_scrapes_never_fetched_before_refreshing_stale_ones(env, monkeypatch):
    env.tournaments = {"a": {"dates": ["2026-12-06 00:00"]}, "z": {}}
    write_json(env.paths["FETCHED_TOURNAMENTS_PATH"], {"a": {"fetchedAt": OLD}})
    fake_clock(monkeypatch, sat, 0.0, 1.0)
    run_main(monkeypatch, sat, *args(env))
    assert env.fetches[0][0] == "z"


def test_main_refreshes_my_stale_tournament_before_other_unfetched_ones(env, monkeypatch):
    env.tournaments = {"a": {"dates": ["2026-12-06 00:00"]}, "z": {}}
    write_json(env.paths["MY_TOURNAMENTS_PATH"], ["a"])
    write_json(env.paths["FETCHED_TOURNAMENTS_PATH"], {"a": {"fetchedAt": OLD}})
    fake_clock(monkeypatch, sat, 0.0, 1.0)
    run_main(monkeypatch, sat, *args(env))
    assert env.fetches[0][0] == "a"
