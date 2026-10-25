import subprocess
import sys

import pytest

from helpers_fetchers import header_map, install_urlopen, load_module, no_sleep, read_json, url_error, write_json


@pytest.fixture
def core(monkeypatch, tmp_path):
    module = load_module(monkeypatch, tmp_path, "pool_fetch_core")
    monkeypatch.setattr(module, "DATA_DIR", tmp_path)
    return module


def player_cell(pid, flag, member="1"):
    return f'<a href="player.aspx?id=AB-1&player={pid}">Name</a></td><td>{member}</td><td>{flag}</td>'


ROSTER_HTML = (
    '<td class="maleplayers">' + player_cell(11, "Ja") + player_cell(12, "Nee")
    + '<td class="femaleplayers">' + player_cell(21, "Yes") + player_cell(22, "No")
    + '<div id="addTeamPlayerTable"></div>' + player_cell(99, "Ja")
)


def test_default_tournament_id_and_noop_progress(core):
    assert core.CURRENT_TOURNAMENT_ID == "9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E"
    assert core._noop_progress("step", 1, "detail") is None


def test_fetch_merges_extra_headers(monkeypatch, core):
    fake = install_urlopen(monkeypatch, {"/x": "body"})
    assert core.fetch("http://h/x", "c=1", extra_headers={"X-Requested-With": "XMLHttpRequest"}) == "body"
    headers = header_map(fake.requests[0])
    assert headers["cookie"] == "c=1" and headers["x-requested-with"] == "XMLHttpRequest"
    core.fetch("http://h/x", "c=2")
    assert "x-requested-with" not in header_map(fake.requests[1])


@pytest.mark.parametrize(
    "html, expected",
    [
        (
            ROSTER_HTML,
            {"11": {"fixed": True, "gender": "M"}, "12": {"fixed": False, "gender": "M"}, "21": {"fixed": True, "gender": "F"}, "22": {"fixed": False, "gender": "F"}},
        ),
        ('<td class="maleplayers">' + player_cell(11, "Ja") + "addTeamPlayerTable" + player_cell(99, "Ja"), {"11": {"fixed": True, "gender": "M"}}),
        ('<td class="femaleplayers">' + player_cell(21, "Nee"), {"21": {"fixed": False, "gender": "F"}}),
        ("<html>nothing</html>", {}),
    ],
    ids=["both-genders", "male-only", "female-only-no-end-marker", "no-roster"],
)
def test_fetch_team_fixed_status(monkeypatch, core, html, expected):
    fake = install_urlopen(monkeypatch, {"teamplayers.aspx": html})
    assert core.fetch_team_fixed_status("101", "c") == expected
    assert fake.urls[0].endswith(f"teamplayers.aspx?id={core.CURRENT_TOURNAMENT_ID}&tid=101")
    assert header_map(fake.requests[0])["x-requested-with"] == "XMLHttpRequest"


def test_discover_match_participants(monkeypatch, core):
    sleeps = no_sleep(monkeypatch)
    install_urlopen(
        monkeypatch,
        {
            "drawmatches.aspx": "teammatch.aspx?id=AB-1&match=3 teammatch.aspx?id=AB-1&match=2 teammatch.aspx?id=AB-1&match=3 teammatch.aspx?id=AB-1&match=4",
            "match=2": "player.aspx?id=AB-1&player=11 player.aspx?id=AB-1&player=12 team.aspx?id=AB-1&team=101",
            "match=3": url_error("flaky"),
            "match=4": "player.aspx?id=AB-1&player=12 player.aspx?id=AB-1&player=13 team.aspx?id=AB-1&team=102",
        },
    )
    steps = []
    players, teams = core.discover_match_participants("7", "c", 0.5, lambda *args: steps.append(args))
    assert list(players) == ["11", "12", "13"]
    assert teams == {"101", "102"}
    assert sleeps == [0.5, 0.5]
    assert steps[0] == ("matches", 2, "discovering matches")
    assert steps[1] == ("players", pytest.approx(5 + 1 / 3 * 35), "1/3 matches, 2 players found")
    assert steps[-1][2] == "3/3 matches, 3 players found"


def test_discover_match_participants_without_matches(monkeypatch, core):
    install_urlopen(monkeypatch, {"drawmatches.aspx": "<html/>"})
    with pytest.raises(RuntimeError, match="no matches found"):
        core.discover_match_participants("7", "c", 0, core._noop_progress)


def test_fetch_new_team_roster_status_fetches_only_new_teams(monkeypatch, core, tmp_path):
    sleeps = no_sleep(monkeypatch)
    write_json(tmp_path / "team_fixed_status_fetched.json", ["100"])
    write_json(tmp_path / "player_fixed_status.json", {"1": {"fixed": True, "gender": "M"}})
    install_urlopen(monkeypatch, {"tid=101": ROSTER_HTML, "tid=102": url_error("down")})
    steps = []
    roster = core.fetch_new_team_roster_status({"100", "101", "102"}, "c", 0.1, lambda *args: steps.append(args))
    assert roster == {"11", "12", "21", "22"}
    assert steps == [("roster", 39, "fetching fixed-player status for 2 teams")]
    assert sleeps == [0.1]
    assert read_json(tmp_path / "team_fixed_status_fetched.json") == ["100", "101"]
    status = read_json(tmp_path / "player_fixed_status.json")
    assert status["1"]["fixed"] is True and status["21"] == {"fixed": True, "gender": "F"}


def test_fetch_new_team_roster_status_starts_from_empty_files(monkeypatch, core, tmp_path):
    no_sleep(monkeypatch)
    install_urlopen(monkeypatch, {"tid=7": ROSTER_HTML})
    assert core.fetch_new_team_roster_status({"7"}, "c", 0, core._noop_progress) == {"11", "12", "21", "22"}
    assert read_json(tmp_path / "team_fixed_status_fetched.json") == ["7"]


def test_fetch_new_team_roster_status_nothing_new(monkeypatch, core, tmp_path):
    install_urlopen(monkeypatch, {})
    write_json(tmp_path / "team_fixed_status_fetched.json", ["5"])
    assert core.fetch_new_team_roster_status({"5"}, "c", 0, core._noop_progress) == set()
    assert not (tmp_path / "player_fixed_status.json").exists()


def test_update_pool_rosters_merges_cumulatively(core, tmp_path):
    core.update_pool_rosters("5", {"20": None, "3": None}, {"100"})
    core.update_pool_rosters("5", {"4": None}, set())
    core.update_pool_rosters("6", {}, {"1"})
    assert read_json(tmp_path / "pool_rosters.json") == {"5": ["3", "4", "20", "100"], "6": ["1"]}


def test_find_new_player_ids_ignores_other_tournaments(core):
    events = [
        {"tournament_id": core.CURRENT_TOURNAMENT_ID, "player_id": "1"},
        {"tournament_id": "OLD", "player_id": "2"},
    ]
    assert sorted(core.find_new_player_ids({"1": None, "2": None}, {"3"}, events)) == ["2", "3"]


class FakeProc:
    """Popen stand-in: the first poll() creates one page and keeps running, the next exits."""

    def __init__(self, returncode, pages):
        self.returncode = returncode
        self.pages = pages
        self.polls = 0

    def poll(self):
        self.polls += 1
        if self.polls == 1:
            self.pages[0].parent.mkdir(parents=True, exist_ok=True)
            self.pages[0].write_text("page", encoding="utf-8")
            return None
        return self.returncode


def run_fetch_new_player_events(monkeypatch, core, tmp_path, returncode):
    sleeps = no_sleep(monkeypatch)
    pages = [tmp_path / "pages" / "events" / f"{core.CURRENT_TOURNAMENT_ID}_{pid}.html" for pid in ("5", "6")]
    launched = {}

    def fake_popen(cmd, cwd):
        index = tmp_path / "events_index.pool_9.json"
        launched.update(cmd=cmd, cwd=cwd, index_entries=read_json(index))
        return FakeProc(returncode, pages)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    steps = []
    events = [{"tournament_id": "OLD", "player_id": "1"}]
    cookie_file = tmp_path / "cookie.txt"
    core.fetch_new_player_events(["5", "6"], "9", cookie_file, lambda *args: steps.append(args), events)
    return launched, steps, sleeps, events, cookie_file


def test_fetch_new_player_events_runs_fetch_events_and_updates_index(monkeypatch, core, tmp_path):
    launched, steps, sleeps, events, cookie_file = run_fetch_new_player_events(monkeypatch, core, tmp_path, 0)
    index = tmp_path / "events_index.pool_9.json"
    assert launched["cmd"] == [sys.executable, "fetch_events.py", str(index), "--cookie-file", str(cookie_file), "--out", "pages/events"]
    assert launched["cwd"] == tmp_path
    assert [e["player_id"] for e in launched["index_entries"]] == ["5", "6"]
    assert steps == [("career", 40, "0/2 new players"), ("career", 65.0, "1/2 new players")]
    assert sleeps == [1]
    assert not index.exists()
    assert [e["player_id"] for e in read_json(tmp_path / "events_index.json")] == ["1", "5", "6"]
    assert len(events) == 3


def test_fetch_new_player_events_failure_cleans_up(monkeypatch, core, tmp_path):
    with pytest.raises(RuntimeError, match="fetch_events.py failed"):
        run_fetch_new_player_events(monkeypatch, core, tmp_path, 2)
    assert not (tmp_path / "events_index.pool_9.json").exists()
    assert not (tmp_path / "events_index.json").exists()


@pytest.fixture
def stubbed_pipeline(monkeypatch, core, tmp_path):
    state = {"fetched": None}
    write_json(tmp_path / "events_index.json", [{"tournament_id": core.CURRENT_TOURNAMENT_ID, "player_id": "1"}])
    monkeypatch.setattr(core, "discover_match_participants", lambda *a: ({"1": None, "2": None}, {"101"}))
    monkeypatch.setattr(core, "fetch_new_team_roster_status", lambda *a: {"3"})
    monkeypatch.setattr(core, "fetch_new_player_events", lambda *a: state.update(fetched=a[0]))
    return state


def test_fetch_pool_players_fetches_only_unknown_players(core, stubbed_pipeline, tmp_path):
    steps = []
    count = core.fetch_pool_players("9", "c", tmp_path / "cookie.txt", 0.1, lambda *args: steps.append(args))
    assert count == 2
    assert sorted(stubbed_pipeline["fetched"]) == ["2", "3"]
    assert read_json(tmp_path / "pool_rosters.json") == {"9": ["1", "2", "3"]}
    assert steps == []


def test_fetch_pool_players_reports_cached_pool(core, stubbed_pipeline, tmp_path):
    write_json(tmp_path / "events_index.json", [{"tournament_id": core.CURRENT_TOURNAMENT_ID, "player_id": pid} for pid in "123"])
    steps = []
    assert core.fetch_pool_players("9", "c", tmp_path / "cookie.txt", 0, lambda *args: steps.append(args)) == 0
    assert steps == [("career", 90, "all players already cached")]
    assert stubbed_pipeline["fetched"] is None


def test_fetch_pool_players_defaults_to_noop_progress(core, stubbed_pipeline, tmp_path):
    write_json(tmp_path / "events_index.json", [{"tournament_id": core.CURRENT_TOURNAMENT_ID, "player_id": pid} for pid in "123"])
    assert core.fetch_pool_players("9", "c", tmp_path / "cookie.txt") == 0
