import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

import build_career_db as bc
from parse_career import MatchRecord
from helpers_parsers import classic_player_page, classic_row, classic_side, new_template_item

CUR = "CUR-TID"


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(bc, "CURRENT_TOURNAMENT_ID", CUR)
    monkeypatch.setattr(bc, "safe_path", lambda p: Path(p).resolve())


@pytest.fixture
def pages(tmp_path):
    return tmp_path / "pages"


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
    return path


def current_page(name="Jan", guid="AB12", club="Foo BC"):
    row = classic_row(classic_side("Home", [("1", name)], winner="team"), classic_side("Away", [("2", "Piet")]))
    return classic_player_page(name=name, guid=guid, club=club, rows=(row,))


def event_page():
    item = new_template_item(home=[("5", "Jan")], away=[("6", "Kees")], home_won=True)
    return classic_player_page(name=None, member_id=None, club=None, overview=False, extra=item)


def info(guid=None, name="Page Name", club="Club", member_id="42", matches=()):
    return SimpleNamespace(profile_guid=guid, name=name, club=club, member_id=member_id, matches=list(matches))


def test_discover_files_lists_current_and_event_pages(pages):
    write(pages / "player_1.html", "x")
    write(pages / "player_abc.html", "x")
    write(pages / "events" / "AB-12_5.html", "x")
    write(pages / "events" / "junk.html", "x")

    found = bc.discover_files(pages)

    assert [(p.name, tid, pid) for p, tid, pid in found] == [("player_1.html", CUR, "1"), ("AB-12_5.html", "AB-12", "5")]


def test_discover_files_without_events_dir(pages):
    write(pages / "player_1.html", "x")

    assert [pid for _, _, pid in bc.discover_files(pages)] == ["1"]


def test_state_roundtrip_sanitizes_control_characters(tmp_path):
    path = tmp_path / "state.json"
    assert bc.load_state(path) == {"parsed_files": [], "players": {}}

    bc.save_state(path, {"parsed_files": ["a\x00b"], "players": {}})

    assert bc.load_state(path) == {"parsed_files": ["ab"], "players": {}}


def test_load_event_source_map(pages):
    assert bc.load_event_source_map(pages) == {}

    write(
        pages.parent / "events_index.json",
        [
            {"tournament_id": "T1", "player_id": "5", "source_player_file": "player_1", "source_player_name": "Jan"},
            {"tournament_id": "T2", "player_id": "6", "source_player_file": "player_2"},
            {"tournament_id": "T3", "player_id": "7", "source_player_file": "events/other"},
            {"tournament_id": "T4", "player_id": "8"},
        ],
    )

    assert bc.load_event_source_map(pages) == {("T1", "5"): ("player_1", "Jan"), ("T2", "6"): ("player_2", None)}


def test_build_alias_reverse_index():
    players = {"AB12": {"aliases": {"T:1": {}, "T:2": {}}}, "G2": {"aliases": {"T:3": {}}}, "G3": {}}

    assert bc.build_alias_reverse_index(players) == {"T:1": "AB12", "T:2": "AB12", "T:3": "G2"}


@pytest.mark.parametrize(
    "page_info,source_map,aliases,expected",
    [
        (info(guid="G9"), {}, {}, ("G9", "Page Name")),
        (info(), {("T", "5"): ("player_1", "Source Jan")}, {f"{CUR}:1": "AB12"}, ("AB12", "Source Jan")),
        (info(), {("T", "5"): ("player_1", "Source Jan")}, {}, ("noguid:Source Jan", "Source Jan")),
        (info(), {("T", "5"): ("player_1", None)}, {f"{CUR}:1": "AB12"}, ("AB12", "Page Name")),
        (info(), {}, {}, ("noguid:Page Name", "Page Name")),
    ],
)
def test_resolve_guid_and_name(page_info, source_map, aliases, expected):
    assert bc.resolve_guid_and_name(page_info, "T", "5", source_map, aliases) == expected


def test_record_player_file_creates_then_updates_entry():
    state = {"players": {}}
    aliases = {}
    match = MatchRecord("T1", "1", "", "", "", "", [], "", [], "", "")

    bc.record_player_file(state, aliases, "T1", "1", info(club="Old Club", matches=[match]), "AB12", "Jan")
    bc.record_player_file(state, aliases, "T2", "2", info(club=None), "AB12", "Jan J.")
    bc.record_player_file(state, aliases, "T3", "3", info(club="New Club"), "AB12", "Jan J.")

    entry = state["players"]["AB12"]
    assert (entry["name"], entry["member_id"], entry["club"]) == ("Jan", "42", "New Club")
    assert entry["aliases"]["T2:2"] == {"name": "Jan J.", "club": None}
    assert len(entry["matches"]) == 1
    assert aliases == {"T1:1": "AB12", "T2:2": "AB12", "T3:3": "AB12"}


def build_pages(pages):
    write(pages / "player_1.html", current_page())
    write(pages / "events" / "EF_5.html", event_page())
    write(pages.parent / "events_index.json", [{"tournament_id": "EF", "player_id": "5", "source_player_file": "player_1", "source_player_name": "Jan"}])


def test_run_pass_links_event_pages_to_current_season_profile(pages):
    build_pages(pages)
    state = {"parsed_files": [], "players": {}}

    assert bc.run_pass(pages, state) == 2

    assert state["parsed_files"] == ["events/EF_5.html", "player_1.html"]
    assert list(state["players"]) == ["AB12"]
    player = state["players"]["AB12"]
    assert set(player["aliases"]) == {f"{CUR}:1", "EF:5"}
    assert len(player["matches"]) == 2
    assert bc.run_pass(pages, state) == 0


def test_run_pass_skips_unparseable_files_but_marks_them_done(pages, monkeypatch, capsys):
    write(pages / "player_1.html", current_page())
    write(pages / "player_2.html", "x")
    real_parse = bc.parse_player_file

    def flaky(path, tid, pid):
        if pid == "2":
            raise RuntimeError("boom")
        return real_parse(path, tid, pid)

    monkeypatch.setattr(bc, "parse_player_file", flaky)
    state = {"parsed_files": [], "players": {}}

    assert bc.run_pass(pages, state) == 1

    assert state["parsed_files"] == ["player_1.html", "player_2.html"]
    assert "WARN: failed to parse" in capsys.readouterr().out


def run_main(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["build_career_db.py", *map(str, argv)])
    bc.main()


def test_main_single_pass_writes_output_and_state(pages, monkeypatch, capsys):
    build_pages(pages)
    out = pages.parent / "career.json"

    run_main(monkeypatch, pages, "--out", out)

    assert list(json.loads(out.read_text(encoding="utf-8"))) == ["AB12"]
    state = json.loads((pages.parent / "career.state.json").read_text(encoding="utf-8"))
    assert len(state["parsed_files"]) == 2
    assert "Parsed 2 new files. Total files parsed: 2. Players: 1" in capsys.readouterr().out

    run_main(monkeypatch, pages, "--out", out)
    assert "Parsed 0 new files. Total files parsed: 2" in capsys.readouterr().out


def test_main_honours_explicit_state_path(pages, monkeypatch):
    build_pages(pages)
    state_path = pages.parent / "custom-state.json"

    run_main(monkeypatch, pages, "--out", pages.parent / "career.json", "--state", state_path)

    assert state_path.exists()
    assert not (pages.parent / "career.state.json").exists()


@pytest.fixture
def fake_clock(monkeypatch):
    sleeps = []
    monkeypatch.setattr(bc, "time", SimpleNamespace(sleep=sleeps.append, strftime=lambda fmt: "12:00:00"))
    return sleeps


def test_main_watch_stops_once_target_count_is_reached(pages, monkeypatch, capsys, fake_clock):
    build_pages(pages)

    run_main(monkeypatch, pages, "--out", pages.parent / "career.json", "--watch", "5", "--until-count", "2")

    out = capsys.readouterr().out
    assert "Watching" in out
    assert "[12:00:00] +2 new -> total parsed 2, players 1" in out
    assert "Reached target of 2 parsed files. Stopping." in out
    assert fake_clock == []


def test_main_watch_keeps_polling_until_interrupted(pages, monkeypatch, capsys, fake_clock):
    build_pages(pages)

    def stop_after_two(seconds):
        fake_clock.append(seconds)
        if len(fake_clock) == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(bc.time, "sleep", stop_after_two)

    with pytest.raises(KeyboardInterrupt):
        run_main(monkeypatch, pages, "--out", pages.parent / "career.json", "--watch", "5", "--until-count", "99")

    assert fake_clock == [5.0, 5.0]
    assert capsys.readouterr().out.count("new ->") == 1
