from datetime import datetime, timedelta, timezone

import pytest

import scrape_national_players as snp
from helpers_national import FakeSite, Ticker
from helpers_orchestrators import FIXED_NOW, exit_code, freeze_datetime, isolate_module, read_json, write_json
from national_rankings import BlockedError

COOKIE = "sid=abc"
# Both lists are always checked, so the fake site always serves both: 3 + 2 pages (adult) and 1 page (junior).
LISTS = {
    "75": {"weekId": "54110", "week": "40-2026", "categories": {"491": ("Mannen Enkel", 3), "492": ("Vrouwen Enkel", 2)}},
    "164": {"weekId": "54111", "week": "40-2026", "categories": {"1931": ("Mannen Enkel", 1)}},
}
TOTAL_PAGES = 6


def new_state():
    return {"lists": {}, "players": {}, "budget": {}, "block": {"count": 0, "until": None}}


def install_site(monkeypatch, lists=None):
    site = FakeSite(LISTS if lists is None else lists)
    monkeypatch.setattr(snp, "fetch_page", site)
    return site


def run_crawl(state, **overrides):
    options = {"slice_seconds": 10_000, "budget_seconds": 10_000, "now": FIXED_NOW, "clock": Ticker()}
    options.update(overrides)
    return snp.crawl(state, COOKIE, **options)


def test_load_state_defaults_and_roundtrips(tmp_path):
    path = tmp_path / "state.json"
    assert snp.load_state(path) == new_state()
    state = snp.load_state(path)
    state["players"]["1"] = {"name": "A"}
    snp.save_state(state, path)
    assert snp.load_state(path)["players"] == {"1": {"name": "A"}}
    assert " " not in path.read_text(encoding="utf-8")  # compact


def test_load_state_fills_in_keys_missing_from_an_older_file(tmp_path):
    path = tmp_path / "state.json"
    write_json(path, {"players": {"1": {}}})
    assert snp.load_state(path)["block"] == {"count": 0, "until": None}


def test_daily_budget_resets_on_a_new_day_and_is_kept_within_a_day():
    state = new_state()
    assert snp.load_daily_budget(state, FIXED_NOW, 8) == {"dayStart": "2026-10-02T08:00:00+00:00", "workSeconds": 0.0}
    state["budget"]["workSeconds"] = 42.0
    assert snp.load_daily_budget(state, FIXED_NOW, 8)["workSeconds"] == 42.0
    assert snp.load_daily_budget(state, FIXED_NOW + timedelta(days=1), 8)["workSeconds"] == 0.0


def test_current_day_start_is_the_previous_boundary_before_the_reset_hour():
    early = datetime(2026, 10, 2, 3, 0, tzinfo=timezone.utc)
    assert snp.current_day_start(early, 8) == datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)


def test_a_block_backs_off_for_longer_each_time_up_to_a_day():
    state = new_state()
    hours = []
    for _ in range(5):
        until = snp.record_block(state, FIXED_NOW)
        hours.append((until - FIXED_NOW) / timedelta(hours=1))
    assert hours == [1, 6, 24, 24, 24]
    assert state["block"]["count"] == 5
    assert snp.cooldown_until(state) == FIXED_NOW + timedelta(hours=24)


def test_cooldown_is_empty_without_a_block():
    assert snp.cooldown_until(new_state()) is None


@pytest.mark.parametrize(
    "entry,due",
    [
        (None, True),
        ({"categories": {"1": {"pages": None, "next": 1}}, "checkedAt": "2026-10-01T11:00:00Z"}, False),  # nothing read yet
        ({"categories": {"1": {"pages": 2, "next": 2}}, "checkedAt": "2026-10-01T11:00:00Z"}, False),  # still crawling
        ({"categories": {"1": {"pages": 2, "next": 3}}, "checkedAt": "2026-10-02T11:00:00Z"}, False),  # done, checked an hour ago
        ({"categories": {"1": {"pages": 2, "next": 3}}, "checkedAt": "2026-10-01T11:00:00Z"}, True),  # done, a day old
        ({"categories": {"1": {"pages": 2, "next": 3}}}, True),  # done, never timestamped
    ],
)
def test_list_check_is_due_only_for_a_new_list_or_a_finished_crawl_that_is_a_day_old(entry, due):
    assert snp.list_check_due(entry, FIXED_NOW) is due


def test_refresh_list_starts_a_new_week_over_but_keeps_progress_within_the_same_week(monkeypatch):
    site = install_site(monkeypatch)
    state = new_state()
    snp.refresh_list(state, "75", COOKIE, FIXED_NOW)
    assert state["lists"]["75"]["checkedAt"] == "2026-10-02T12:00:00Z"
    state["lists"]["75"]["categories"]["491"].update(pages=3, next=3)

    snp.refresh_list(state, "75", COOKIE, FIXED_NOW)
    assert state["lists"]["75"]["categories"]["491"]["next"] == 3  # same week: progress kept

    site.lists["75"]["weekId"], site.lists["75"]["week"] = "54200", "44-2026"
    snp.refresh_list(state, "75", COOKIE, FIXED_NOW)
    assert state["lists"]["75"]["weekId"] == "54200"
    assert state["lists"]["75"]["categories"]["491"] == {"label": "Mannen Enkel", "pages": None, "next": 1}


def test_next_work_follows_list_order_and_skips_finished_categories():
    state = {"lists": {
        "164": {"categories": {"9": {"pages": None, "next": 1}}},
        "75": {"categories": {"1": {"pages": 2, "next": 3}, "2": {"pages": 4, "next": 2}}},
    }}
    assert snp.next_work(state) == ("75", "2", 2)
    state["lists"]["75"]["categories"]["2"]["next"] = 5
    assert snp.next_work(state) == ("164", "9", 1)
    state["lists"]["164"]["categories"]["9"].update(pages=1, next=2)
    assert snp.next_work(state) is None
    assert snp.next_work({"lists": {}}) is None


def test_record_rows_replaces_ranks_from_an_older_week_and_adds_categories_within_a_week():
    state = new_state()
    row = {"rank": 1, "playerId": "p1", "name": "Old Name", "memberId": "m1", "points": 10, "matches": 2}
    snp.record_rows(state, "75", "36-2026", {"label": "Mannen Enkel", "rows": [row]})
    snp.record_rows(state, "75", "36-2026", {"label": "Mannen Dubbel", "rows": [{**row, "rank": 4}]})
    assert set(state["players"]["m1"]["ranks"]["75"]["rankings"]) == {"Mannen Enkel", "Mannen Dubbel"}

    snp.record_rows(state, "75", "40-2026", {"label": "Mannen Enkel", "rows": [{**row, "name": "New Name"}]})
    player = state["players"]["m1"]
    assert player["name"] == "New Name"
    assert player["ranks"]["75"] == {"week": "40-2026", "rankings": {"Mannen Enkel": {"rank": 1, "points": 10, "matches": 2}}}


def test_a_full_crawl_reads_every_page_of_every_list_then_reports_nothing_left(monkeypatch):
    site = install_site(monkeypatch)
    state = new_state()

    assert run_crawl(state) == snp.NOTHING_TO_DO

    assert len(site.category_requests()) == TOTAL_PAGES
    assert len(state["players"]) == TOTAL_PAGES
    assert snp.next_work(state) is None
    assert site.category_requests()[0] == "/ranking/category.aspx?id=54110&category=491&p=1&ps=25"


def test_a_slice_ends_the_run_with_work_left_and_the_next_run_resumes_where_it_stopped(monkeypatch):
    site = install_site(monkeypatch)
    state = new_state()

    assert run_crawl(state, slice_seconds=3) == 0
    assert len(site.category_requests()) == 2
    assert state["budget"]["workSeconds"] > 0

    assert run_crawl(state) == snp.NOTHING_TO_DO
    assert len(site.category_requests()) == TOTAL_PAGES
    assert len(set(site.category_requests())) == TOTAL_PAGES  # no page read twice


def test_the_daily_budget_stops_a_run_even_when_the_slice_is_not_used_up(monkeypatch):
    site = install_site(monkeypatch)
    state = new_state()
    state["budget"] = {"dayStart": "x", "workSeconds": 100.0}

    assert run_crawl(state, budget_seconds=102) == 0
    assert len(site.category_requests()) == 1
    assert state["budget"]["workSeconds"] > 100.0


def test_progress_is_saved_every_few_pages_and_a_success_clears_an_old_block(monkeypatch):
    install_site(monkeypatch, {
        "75": {"weekId": "1", "week": "w", "categories": {"491": ("Mannen Enkel", 25)}},
        "164": {"weekId": "2", "week": "w", "categories": {"1931": ("Mannen Enkel", 1)}},
    })
    state = new_state()
    state["block"] = {"count": 2, "until": "2026-10-01T00:00:00Z"}
    saves = []

    run_crawl(state, save=lambda: saves.append(len(state["players"])))

    assert saves == [10, 20]
    assert state["block"] == {"count": 0, "until": None}


def test_pause_runs_between_requests(monkeypatch):
    install_site(monkeypatch)
    pauses = []
    run_crawl(new_state(), pause=lambda: pauses.append(1))
    assert len(pauses) == 2 + TOTAL_PAGES  # after each list check and each page


def prepare_main(monkeypatch, tmp_path, state=None):
    """Points the driver at tmp_path, freezes time, and writes the cookie file; returns (state path, argv)."""
    state_path = tmp_path / "national_players.json"
    isolate_module(monkeypatch, snp, tmp_path, "STATE_PATH")
    freeze_datetime(monkeypatch, snp)
    monkeypatch.setattr(snp.time, "sleep", lambda seconds: None)
    real_load, real_save = snp.load_state, snp.save_state
    monkeypatch.setattr(snp, "load_state", lambda path=state_path: real_load(path))
    monkeypatch.setattr(snp, "save_state", lambda data, path=state_path: real_save(data, path))
    if state is not None:
        write_json(state_path, state)
    cookie = tmp_path / "ranking_cookie.txt"
    cookie.write_text(COOKIE, encoding="utf-8")
    return state_path, ["--cookie-file", str(cookie), "--delay-min", "0", "--delay-max", "0"]


def test_main_scrapes_until_nothing_is_left_and_saves_state(monkeypatch, tmp_path):
    state_path, argv = prepare_main(monkeypatch, tmp_path)
    install_site(monkeypatch)

    assert exit_code(monkeypatch, snp, *argv) == snp.NOTHING_TO_DO

    saved = read_json(state_path)
    assert len(saved["players"]) == TOTAL_PAGES
    assert saved["budget"]["dayStart"] == "2026-10-02T08:00:00+00:00"


def test_main_does_nothing_while_backing_off_and_never_touches_the_site(monkeypatch, tmp_path, capsys):
    _, argv = prepare_main(monkeypatch, tmp_path, {"block": {"count": 1, "until": "2026-10-02T13:00:00Z"}})
    site = install_site(monkeypatch)

    assert exit_code(monkeypatch, snp, *argv) == snp.NOTHING_TO_DO

    assert site.requests == []
    assert "Backing off" in capsys.readouterr().out


def test_main_ignores_a_cooldown_and_the_budget_when_forced(monkeypatch, tmp_path):
    _, argv = prepare_main(monkeypatch, tmp_path, {
        "block": {"count": 1, "until": "2026-10-02T13:00:00Z"},
        "budget": {"dayStart": "2026-10-02T08:00:00+00:00", "workSeconds": 99999},
    })
    site = install_site(monkeypatch)

    assert exit_code(monkeypatch, snp, *argv, "--force") == snp.NOTHING_TO_DO
    assert len(site.category_requests()) == TOTAL_PAGES


def test_main_stops_when_the_daily_budget_is_used_up(monkeypatch, tmp_path, capsys):
    _, argv = prepare_main(monkeypatch, tmp_path, {"budget": {"dayStart": "2026-10-02T08:00:00+00:00", "workSeconds": 99999}})
    site = install_site(monkeypatch)

    assert exit_code(monkeypatch, snp, *argv, "--budget-minutes", "10") == snp.NOTHING_TO_DO
    assert site.requests == []
    assert "budget used up" in capsys.readouterr().out


def test_main_backs_off_when_the_site_pushes_back_and_keeps_what_it_read(monkeypatch, tmp_path, capsys):
    state_path, argv = prepare_main(monkeypatch, tmp_path)
    site = FakeSite(LISTS)

    def block_after_two_pages(path, cookie, sleep=None):
        if len(site.category_requests()) >= 2:
            raise BlockedError("HTTP 429")
        return site(path, cookie)

    monkeypatch.setattr(snp, "fetch_page", block_after_two_pages)

    assert exit_code(monkeypatch, snp, *argv) == snp.NOTHING_TO_DO

    saved = read_json(state_path)
    assert saved["block"] == {"count": 1, "until": "2026-10-02T13:00:00Z"}
    assert len(saved["players"]) == 2
    assert "::warning::" in capsys.readouterr().out


def test_main_saves_progress_and_fails_loudly_on_an_unexpected_error(monkeypatch, tmp_path):
    state_path, argv = prepare_main(monkeypatch, tmp_path)
    site = FakeSite(LISTS)

    def fail_after_two_pages(path, cookie, sleep=None):
        if len(site.category_requests()) >= 2:
            raise RuntimeError("boom")
        return site(path, cookie)

    monkeypatch.setattr(snp, "fetch_page", fail_after_two_pages)

    with pytest.raises(RuntimeError, match="boom"):
        exit_code(monkeypatch, snp, *argv)

    assert len(read_json(state_path)["players"]) == 2
