import json
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import refresh_league_results as rlr
from helpers_orchestrators import exit_code, isolate_module, read_json, run_main, write_json
from helpers_parsers import classic_player_page, classic_row, classic_side

TID = rlr.CURRENT_TOURNAMENT_ID
NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
GUID = "AB12-cd34"


def pool_row(match_id, planned="za 10-10-2026 13:30", score="4-4"):
    day, clock = planned.rsplit(" ", 1)
    score_html = f'<span class="score"><span>{score}</span></span>' if score else '<span class="score"></span>'
    return (
        f'<tr><td></td><td class="plannedtime" align="right">{day} <span class="time">{clock}</span></td>'
        f'<td class="nowrap"><a class="teamname" href="teammatch.aspx?id={TID}&match={match_id}">A</a></td>'
        f"<td>{score_html}</td></tr>"
    )


def pool_page(*rows):
    return "<table class='ruler matches'><thead><tr><td>Tijdstip</td></tr></thead><tbody>" + "".join(rows) + "</tbody></table>"


def player_page(*rows, guid=GUID, name="Jan Jansen"):
    return classic_player_page(name=name, guid=guid, rows=tuple(rows))


def match_row(opponent="Piet", score="21-15 21-10", time="Sat 12/09/2026 13:30"):
    return classic_row(
        classic_side("DEO BV M2", (("5", "Jan Jansen"),), "team"),
        classic_side("VELO M1", (("9", opponent),)),
        time=time,
        score=score,
    )


class FakeSite:
    """Serves pool and player pages; a value may be an exception to raise."""

    def __init__(self, pools=None, players=None):
        self.pools = pools or {}
        self.players = players or {}
        self.pool_requests = []
        self.player_requests = []

    def fetch_pool(self, url, cookie):
        draw = url.split("draw=")[1]
        self.pool_requests.append(draw)
        return self._serve(self.pools[draw])

    def fetch_player(self, url, cookie):
        player = url.split("player=")[1]
        self.player_requests.append(player)
        return self._serve(self.players[player])

    @staticmethod
    def _serve(value):
        if isinstance(value, BaseException):
            raise value
        return value


@pytest.fixture
def env(monkeypatch, tmp_path):
    paths = isolate_module(monkeypatch, rlr, tmp_path, "DRAW_TEAMS_PATH", "POOL_ROSTERS_PATH", "STATE_PATH", "CAREER_STATE_PATH", "CAREER_PATH")
    monkeypatch.setattr(rlr, "PAGES_DIR", tmp_path / "pages")
    monkeypatch.setattr(rlr.time, "sleep", lambda _s: None)
    site = FakeSite()
    monkeypatch.setattr(rlr, "fetch_basic_retry", site.fetch_pool)
    monkeypatch.setattr(rlr, "fetch_player_page", site.fetch_player)
    cookie = tmp_path / "cookie.txt"
    cookie.write_text("sess=1\n", encoding="utf-8")
    return type("Env", (), {"paths": paths, "site": site, "cookie": cookie, "tmp": tmp_path})


def career(*, matches=None, alias="5"):
    return {
        "parsed_files": [],
        "players": {GUID: {"name": "Jan Jansen", "club": "DEO BV", "aliases": {f"{TID}:{alias}": {"name": "Jan Jansen", "club": "DEO BV"}}, "matches": matches or []}},
    }


def stored(opponent="Piet", score="21-15 21-10", tournament=TID, source="5"):
    return {
        "tournament_id": tournament, "source_player_id": source, "time": "Sat 12/09/2026 13:30", "event": "MS", "draw": "Afd 1A",
        "home_team": "DEO BV M2", "home_players": [["5", "Jan Jansen"]], "away_team": "VELO M1", "away_players": [["9", opponent]],
        "score": score, "winner_side": "home",
    }


# --- pool results -----------------------------------------------------------

def test_parse_pool_results_reads_time_and_score_per_match():
    html = pool_page(pool_row("8605", "za 12-9-2026 13:30", "1-7"), pool_row("8596", "za 12-9-2026 15:00", ""), "<tr><td>no match here</td></tr>")
    assert rlr.parse_pool_results(html) == {"8605": ("za 12-9-2026 13:30", "1-7"), "8596": ("za 12-9-2026 15:00", "")}


def test_parse_pool_results_of_an_error_page_is_empty():
    assert rlr.parse_pool_results("<html>Log in</html>") == {}


def test_fingerprint_follows_results_not_order():
    a = {"1": ("t", "4-4"), "2": ("t", "")}
    assert rlr.fingerprint(a) == rlr.fingerprint(dict(reversed(list(a.items()))))
    assert rlr.fingerprint(a) != rlr.fingerprint({"1": ("t", "4-4"), "2": ("t", "5-3")})
    assert rlr.fingerprint(a) != rlr.fingerprint({"1": ("t", "4-4"), "2": ("later", "")})


def test_draw_order_puts_the_priority_pool_first_then_numeric():
    assert rlr.draw_order(["10", "2", "135", "1"]) == ["135", "1", "2", "10"]
    assert rlr.draw_order(["10", "2"]) == ["2", "10"]


def test_queue_players_skips_those_already_queued():
    state = rlr.new_state()
    assert rlr.queue_players(state, ["1", "2"]) == 2
    assert rlr.queue_players(state, ["2", "3"]) == 1
    assert state["pending"] == ["1", "2", "3"]


def test_check_pools_queues_a_pool_seen_for_the_first_time_only_if_it_has_results(env):
    env.site.pools = {"1": pool_page(pool_row("1", score="4-4")), "2": pool_page(pool_row("2", score=""))}
    state = rlr.new_state()
    queued = rlr.check_pools(state, ["1", "2"], {"1": ["10", "11"], "2": ["20"]}, "c", 0, NOW)
    assert queued == 2 and state["pending"] == ["10", "11"]
    assert state["pools"]["1"]["played"] == 1 and state["pools"]["2"]["played"] == 0
    assert state["lastPoolCheck"] == "2026-10-12T12:00:00+00:00"


def test_check_pools_queues_a_known_pool_only_when_its_results_changed(env):
    state = rlr.new_state()
    env.site.pools = {"1": pool_page(pool_row("1", score="4-4")), "2": pool_page(pool_row("2", score=""))}
    rlr.check_pools(state, ["1", "2"], {"1": ["10"], "2": ["20"]}, "c", 0, NOW)
    state["pending"].clear()

    assert rlr.check_pools(state, ["1", "2"], {"1": ["10"], "2": ["20"]}, "c", 0, NOW) == 0
    env.site.pools["2"] = pool_page(pool_row("2", score="6-2"))
    assert rlr.check_pools(state, ["1", "2"], {"1": ["10"], "2": ["20"]}, "c", 0, NOW) == 1
    assert state["pending"] == ["20"]


def test_check_pools_checks_the_priority_pool_first_and_survives_failures(env, capsys):
    env.site.pools = {"1": pool_page(pool_row("1")), "135": pool_page(pool_row("135")), "3": urllib.error.URLError("down"), "4": "<html>login</html>"}
    state = rlr.new_state()
    rlr.check_pools(state, ["1", "3", "4", "135"], {"1": ["a"], "135": ["b"]}, "c", 0, NOW)
    assert env.site.pool_requests == ["135", "1", "3", "4"]
    assert state["pending"] == ["b", "a"]
    assert set(state["pools"]) == {"1", "135"}  # neither the failed nor the login page was recorded
    assert "pool 3: FAILED" in capsys.readouterr().out


def test_pool_check_due_waits_the_interval():
    state = rlr.new_state()
    assert rlr.pool_check_due(state, NOW, 6)
    state["lastPoolCheck"] = (NOW - timedelta(hours=2)).isoformat()
    assert not rlr.pool_check_due(state, NOW, 6)
    state["lastPoolCheck"] = (NOW - timedelta(hours=7)).isoformat()
    assert rlr.pool_check_due(state, NOW, 6)


def test_roll_budget_resets_on_a_new_day_only():
    state = rlr.new_state()
    first = rlr.roll_budget(state, NOW, 8)
    first["workSeconds"] = 99
    assert rlr.roll_budget(state, NOW + timedelta(hours=3), 8)["workSeconds"] == 99
    assert rlr.roll_budget(state, NOW + timedelta(days=1), 8)["workSeconds"] == 0.0


# --- refreshing one player --------------------------------------------------

def refresh(env, html, state=None):
    env.site.players["5"] = html
    state = state or career()
    return rlr.refresh_player(state, "5", "c", {}, env.tmp / "pages"), state


def test_refresh_player_replaces_their_matches_and_keeps_everyone_elses(env):
    other_season = stored(tournament="OLD")
    someone_else = stored(opponent="Kees", source="7")
    old = stored(score="")
    status, state = refresh(env, player_page(match_row(score="21-15 21-10"), match_row("Kees", "21-9 21-9", "Sun 13/09/2026 10:00")), career(matches=[old, other_season, someone_else]))

    matches = state["players"][GUID]["matches"]
    assert status == "updated"
    assert other_season in matches and someone_else in matches and old not in matches
    mine = [m for m in matches if m["tournament_id"] == TID and m["source_player_id"] == "5"]
    assert [(m["score"], m["winner_side"]) for m in mine] == [("21-15 21-10", "home"), ("21-9 21-9", "home")]
    assert "player_5.html" in state["parsed_files"]
    assert (env.tmp / "pages" / "player_5.html").exists()


def test_refresh_player_is_idempotent(env):
    html = player_page(match_row())
    _, state = refresh(env, html)
    _, state = refresh(env, html, state)
    assert len(state["players"][GUID]["matches"]) == 1


def test_refresh_player_adds_a_player_who_is_new(env):
    status, state = refresh(env, player_page(match_row()), {"parsed_files": [], "players": {}})
    assert status == "updated" and len(state["players"][GUID]["matches"]) == 1


def test_refresh_player_leaves_the_data_alone_for_a_page_that_is_not_a_player_page(env):
    original = career(matches=[stored()])
    status, state = refresh(env, "<html>Log in to continue</html>", original)
    assert status == "kept" and state["players"][GUID]["matches"] == [stored()]


def test_refresh_player_never_replaces_matches_with_an_empty_page(env):
    status, state = refresh(env, player_page(), career(matches=[stored()]))
    assert status == "kept" and state["players"][GUID]["matches"] == [stored()]


def test_refresh_player_accepts_an_empty_page_for_a_player_without_matches(env):
    status, state = refresh(env, player_page(), career())
    assert status == "updated" and state["players"][GUID]["matches"] == []


# --- the queue --------------------------------------------------------------

def run_queue(env, state, deadline=10**9):
    return rlr.process_pending(state, career(), "c", 0, deadline)


def test_process_pending_counts_each_outcome_and_empties_the_queue(env):
    env.site.players = {"5": player_page(match_row()), "6": "<html>login</html>", "7": urllib.error.HTTPError("u", 404, "gone", {}, None)}
    state = rlr.new_state()
    state["pending"] = ["5", "6", "7"]
    counts = run_queue(env, state)
    assert counts == {"updated": 1, "kept": 1, "failed": 0, "dropped": 1}
    assert state["pending"] == []


def test_process_pending_retries_a_transient_failure_a_limited_number_of_times(env):
    env.site.players = {"5": urllib.error.URLError("boom")}
    state = rlr.new_state()
    state["pending"] = ["5"]
    counts = run_queue(env, state)
    assert counts["failed"] == rlr.MAX_ATTEMPTS and state["pending"] == []
    assert env.site.player_requests == ["5"] * rlr.MAX_ATTEMPTS
    assert state["gaveUp"] == ["5"] and state["attempts"] == {}


def test_a_player_who_was_given_up_on_is_queued_again_at_the_next_pool_check(env):
    env.site.pools = {"1": pool_page(pool_row("1", score="4-4"))}
    state = rlr.new_state()
    rlr.check_pools(state, ["1"], {"1": ["10"]}, "c", 0, NOW)
    state["pending"] = []
    state["gaveUp"] = ["10"]

    assert rlr.check_pools(state, ["1"], {"1": ["10"]}, "c", 0, NOW) == 1  # the pool itself is unchanged
    assert state["pending"] == ["10"] and state["gaveUp"] == []


def test_process_pending_stops_after_repeated_failures_and_keeps_the_rest_queued(env):
    ids = [str(i) for i in range(20, 20 + rlr.MAX_CONSECUTIVE_FAILURES + 3)]
    env.site.players = {pid: urllib.error.URLError("down") for pid in ids}
    state = rlr.new_state()
    state["pending"] = list(ids)
    counts = run_queue(env, state)
    assert counts["failed"] == rlr.MAX_CONSECUTIVE_FAILURES
    assert len(state["pending"]) >= 3


def test_process_pending_stops_at_the_deadline(env):
    env.site.players = {"5": player_page(match_row())}
    state = rlr.new_state()
    state["pending"] = ["5"]
    assert run_queue(env, state, deadline=0)["updated"] == 0
    assert state["pending"] == ["5"]


def test_process_pending_saves_progress_every_so_many_players(env, monkeypatch):
    monkeypatch.setattr(rlr, "SAVE_EVERY", 2)
    saves = []
    monkeypatch.setattr(rlr, "save_progress", lambda state, career_state: saves.append(len(state["pending"])))
    env.site.players = {str(i): player_page(match_row()) for i in range(1, 6)}
    state = rlr.new_state()
    state["pending"] = list(env.site.players)
    rlr.process_pending(state, career(), "c", 0, 10**9)
    assert saves == [3, 1]


# --- main -------------------------------------------------------------------

def setup_main(env, state=None, rosters=None):
    write_json(env.paths["DRAW_TEAMS_PATH"], {"1": {}, "135": {}})
    write_json(env.paths["POOL_ROSTERS_PATH"], rosters if rosters is not None else {"135": ["5"], "1": []})
    write_json(env.paths["CAREER_STATE_PATH"], career(matches=[stored(score="")]))
    if state is not None:
        write_json(env.paths["STATE_PATH"], state)


def test_main_checks_pools_refreshes_queued_players_and_saves_everything(env, monkeypatch, capsys):
    env.site.pools = {"135": pool_page(pool_row("1", score="4-4")), "1": pool_page(pool_row("2", score=""))}
    env.site.players = {"5": player_page(match_row())}
    setup_main(env)
    code = exit_code(monkeypatch, rlr, "--cookie-file", str(env.cookie), "--delay", "0")
    out = capsys.readouterr().out

    assert code == rlr.NOTHING_TO_DO  # queue drained
    assert "Checked 2 pools: 1 players queued" in out and "Refreshed 1 players" in out
    assert read_json(env.paths["STATE_PATH"])["pending"] == []
    assert read_json(env.paths["CAREER_PATH"])[GUID]["matches"][0]["score"] == "21-15 21-10"
    assert read_json(env.paths["CAREER_STATE_PATH"])["players"][GUID]["matches"][0]["score"] == "21-15 21-10"


def test_main_keeps_going_while_players_remain_queued(env, monkeypatch):
    env.site.pools = {"135": pool_page(pool_row("1", score="4-4")), "1": pool_page(pool_row("2"))}
    env.site.players = {"5": player_page(match_row()), "6": player_page(match_row())}
    setup_main(env, rosters={"135": ["5", "6"], "1": []})
    monkeypatch.setattr(rlr.time, "monotonic", iter([0, 0, 100, 100, 100]).__next__)
    run_main(monkeypatch, rlr, "--cookie-file", str(env.cookie), "--delay", "0", "--slice-minutes", "0.5")
    assert read_json(env.paths["STATE_PATH"])["pending"] == ["6"]


def test_main_skips_the_pool_check_until_it_is_due(env, monkeypatch, capsys):
    recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    setup_main(env, state={**rlr.new_state(), "lastPoolCheck": recent})
    assert exit_code(monkeypatch, rlr, "--cookie-file", str(env.cookie), "--delay", "0") == rlr.NOTHING_TO_DO
    assert env.site.pool_requests == [] and "Checked" not in capsys.readouterr().out


def test_main_stops_when_todays_budget_is_used_up_unless_forced(env, monkeypatch, capsys):
    today = rlr.current_day_start(datetime.now(timezone.utc), 8).isoformat()
    full = {**rlr.new_state(), "budget": {"dayStart": today, "workSeconds": 99999}, "lastPoolCheck": datetime.now(timezone.utc).isoformat()}
    setup_main(env, state=full)
    assert exit_code(monkeypatch, rlr, "--cookie-file", str(env.cookie)) == rlr.NOTHING_TO_DO
    assert "Daily budget used up" in capsys.readouterr().out
    assert env.site.player_requests == []

    env.site.pools = {}
    forced = {**full, "pending": ["5"]}
    write_json(env.paths["STATE_PATH"], forced)
    env.site.players = {"5": player_page(match_row())}
    assert exit_code(monkeypatch, rlr, "--cookie-file", str(env.cookie), "--delay", "0", "--force") == rlr.NOTHING_TO_DO
    assert env.site.player_requests == ["5"]


def test_main_fails_loudly_when_every_request_fails(env, monkeypatch):
    env.site.pools = {"135": pool_page(pool_row("1", score="4-4")), "1": pool_page(pool_row("2"))}
    env.site.players = {"5": urllib.error.URLError("down")}
    setup_main(env)
    assert exit_code(monkeypatch, rlr, "--cookie-file", str(env.cookie), "--delay", "0") == 1


def test_refresh_player_keeps_the_data_when_a_parse_lost_the_team_names(env):
    no_teams = classic_row(classic_side("", (("5", "Jan Jansen"),)), classic_side("", (("9", "Piet"),)), time="Sat 12/09/2026 13:30")
    status, state = refresh(env, player_page(no_teams), career(matches=[stored()]))
    assert status == "kept" and state["players"][GUID]["matches"] == [stored()]


def test_refresh_player_stores_a_dutch_page_in_the_standard_time_format(env):
    dutch = match_row(time="za 10-10-2026 13:30")
    status, state = refresh(env, player_page(dutch), career())
    assert status == "updated" and state["players"][GUID]["matches"][0]["time"] == "Sat 10/10/2026 13:30"


def test_refresh_player_keeps_the_data_when_a_time_is_in_an_unrecognised_format(env):
    status, state = refresh(env, player_page(match_row(time="2026-10-10 13:30")), career(matches=[stored()]))
    assert status == "kept" and state["players"][GUID]["matches"] == [stored()]
