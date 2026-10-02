from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

import recheck_tournament_draws as rtd
from helpers_orchestrators import freeze_datetime, isolate_module, read_json, run_main, write_json

SATURDAY = date(2026, 10, 10)
SUNDAY = date(2026, 10, 11)
TOURNAMENTS = {
    "T1": {"name": "One", "dates": ["2026-10-10 09:00"]},
    "T2": {"dates": ["2026-10-10 09:00"]},
    "T3": {"name": "Three", "dates": ["2026-12-10 09:00"]},
    "nodates": {},
    "baddates": {"dates": ["not a date"]},
}
# Friday 2026-10-09 10:30 Amsterdam (CEST), i.e. inside the every-2-hours window for a Saturday tournament.
DUE_NOW = datetime(2026, 10, 9, 8, 30, tzinfo=timezone.utc)
NOT_DUE_NOW = datetime(2026, 9, 1, 8, 30, tzinfo=timezone.utc)


def local(day, hour):
    return datetime(2026, day.month, day.day, hour, 15, tzinfo=rtd.LOCAL_TZ)


@pytest.mark.parametrize("dates,expected", [
    ([], None),
    (["2026-10-10 09:00"], (SATURDAY, SATURDAY)),
    (["2026-10-10 09:00", "2026-10-11 18:00"], (SATURDAY, SUNDAY)),
    (["garbage"], None),
    (["2026-10-10 09:00", "bad"], None),
])
def test_parse_tournament_dates(dates, expected):
    assert rtd.parse_tournament_dates(dates) == expected


@pytest.mark.parametrize("weekday,expected", [(rtd.SUNDAY, 2), (5, 1), (0, 1)])
def test_intensive_days_before_start(weekday, expected):
    assert rtd.intensive_days_before_start(weekday) == expected


@pytest.mark.parametrize("start,today,hour,expected", [
    (SATURDAY, date(2026, 10, 4), 8, False),   # before tournament week
    (SATURDAY, date(2026, 10, 5), 8, True),    # Monday: single daily check at 8
    (SATURDAY, date(2026, 10, 5), 9, False),
    (SATURDAY, date(2026, 10, 5), 7, False),   # never before 8am
    (SATURDAY, date(2026, 10, 8), 8, True),
    (SATURDAY, date(2026, 10, 8), 10, False),  # daily phase: not every 2h yet
    (SATURDAY, date(2026, 10, 9), 8, True),    # Friday: intensive phase
    (SATURDAY, date(2026, 10, 9), 9, False),
    (SATURDAY, date(2026, 10, 9), 10, True),
    (SATURDAY, date(2026, 10, 10), 22, True),
    (SATURDAY, date(2026, 11, 9), 8, True),    # last allowed day (end + 30)
    (SATURDAY, date(2026, 11, 10), 8, False),  # given up
    (SUNDAY, date(2026, 10, 8), 8, True),
    (SUNDAY, date(2026, 10, 8), 10, False),
    (SUNDAY, date(2026, 10, 9), 10, True),     # Sunday start: Friday is already intensive
    (SUNDAY, date(2026, 10, 10), 12, True),
])
def test_check_window(start, today, hour, expected):
    assert rtd.check_window(start, start, today, hour) is expected


@pytest.mark.parametrize("tournament_id,details,now,expected", [
    ("missing", {}, local(date(2026, 10, 9), 10), False),
    ("nodates", {}, local(date(2026, 10, 9), 10), False),
    ("baddates", {}, local(date(2026, 10, 9), 10), False),
    ("T1", {}, local(date(2026, 10, 4), 8), False),
    ("T1", {}, local(date(2026, 10, 9), 10), True),
    ("T1", {"T1": {"draws": []}}, local(date(2026, 10, 9), 10), True),
    ("T1", {"T1": {"draws": [{"draw_id": "1"}]}}, local(date(2026, 10, 9), 10), False),
])
def test_still_pending(tournament_id, details, now, expected):
    assert rtd.still_pending(tournament_id, TOURNAMENTS, details, now) is expected


def test_json_helpers_roundtrip(tmp_path):
    path = tmp_path / "x.json"
    assert rtd.load_json(path, {}) == {}
    rtd.save_json(path, {"naam": "Zoë"})
    assert rtd.load_json(path, None) == {"naam": "Zoë"}


@pytest.fixture
def env(monkeypatch, tmp_path):
    paths = isolate_module(monkeypatch, rtd, tmp_path, "TOURNAMENTS_PATH", "DETAILS_PATH", "MY_TOURNAMENTS_PATH")
    write_json(paths["TOURNAMENTS_PATH"], TOURNAMENTS)
    write_json(paths["MY_TOURNAMENTS_PATH"], ["T1", "T2", "T3", "gone"])
    write_json(paths["DETAILS_PATH"], {"T3": {"draws": []}})
    cookie = tmp_path / "cookie.txt"
    cookie.write_text(" sess=1\n", encoding="utf-8")
    state = SimpleNamespace(paths=paths, cookie=cookie, fetches=[], responses={"T1": {"draws": [1, 2]}, "T2": {"draws": []}})

    def fake_details(tournament_id, cookie_text):
        state.fetches.append((tournament_id, cookie_text))
        return state.responses[tournament_id]

    monkeypatch.setattr(rtd, "fetch_tournament_details", fake_details)
    freeze_datetime(monkeypatch, rtd, DUE_NOW)
    return state


def test_main_rechecks_only_due_tournaments_and_saves(env, monkeypatch, capsys):
    run_main(monkeypatch, rtd, "--cookie-file", str(env.cookie))

    assert env.fetches == [("T1", "sess=1"), ("T2", "sess=1")]
    assert read_json(env.paths["DETAILS_PATH"]) == {"T3": {"draws": []}, "T1": {"draws": [1, 2]}, "T2": {"draws": []}}
    out = capsys.readouterr().out
    assert "Rechecking T1 (One)..." in out
    assert "Rechecking T2 (T2)..." in out
    assert "Draw published! 2 draws now available." in out
    assert "Still no draw published" in out
    assert "Rechecked 2 tournament(s), new draw(s) found." in out


def test_main_reports_no_new_draws(env, monkeypatch, capsys):
    write_json(env.paths["MY_TOURNAMENTS_PATH"], ["T2"])
    run_main(monkeypatch, rtd, "--cookie-file", str(env.cookie))
    assert "Rechecked 1 tournament(s), no new draws yet." in capsys.readouterr().out


def test_main_does_nothing_outside_check_window(env, monkeypatch, capsys):
    freeze_datetime(monkeypatch, rtd, NOT_DUE_NOW)
    run_main(monkeypatch, rtd, "--cookie-file", str(env.cookie))
    assert env.fetches == []
    assert read_json(env.paths["DETAILS_PATH"]) == {"T3": {"draws": []}}
    assert "No registered/favorited tournament is due" in capsys.readouterr().out
