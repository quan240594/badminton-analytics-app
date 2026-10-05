from datetime import date, datetime, timedelta, timezone

import fetch_entrant_rankings as fer
import pytest
from helpers_fetchers import install_urlopen, no_sleep, patch_io, read_json, run_main, url_error, write_cookie, write_json

PLAYER_PAGE = (
    '<h4><a href="/x" class="nav-link media__link text--link-white text--link">'
    '<span class="nav-link__value">Ritvik Chawla</span></a> '
    '<span class="media__title-aside">(10002752)</span> </h4>'
)


def search_item(guid: str, member_id: str) -> str:
    return (
        '<li class="list__item"> <a href="/player-profile/' + guid + '" class="media__img">x</a>'
        '<span class="media__title-aside">(' + member_id + ")</span> </li>"
    )


GUID_A = "18F683D6-B314-4122-87F9-0BC4A5811558"
GUID_B = "014634A7-70EE-4C6F-8371-79075D68132F"


def ranking_row(label: str, rank: int, points: int) -> str:
    return (
        '<tr> <th scope="row" class="th__title"> <a href="/ranking/player.aspx?id=1&player=2">' + label + "</a>\n</th>"
        '<td class="text--right"> <a href="/ranking/player.aspx?id=1&player=2">' + str(rank) + "</a>\n"
        '<svg aria-label="Worse"><use xlink:href="#x"></use></svg></td>'
        '<td class="-m-visible text--right">' + str(points) + "</td> </tr>"
    )


def ranking_list(rid: str, *rows: str) -> str:
    return (
        '<caption><a href="/ranking/ranking.aspx?rid=' + rid + '" class="flex-item flex-item--grow">Name</a></caption>'
        "<tbody>" + "".join(rows) + "</tbody></table>"
    )


ADULT_AND_JUNIOR = ranking_list("75", ranking_row("Mannen Enkel", 2802, 313)) + ranking_list(
    "164", ranking_row("Mannen Enkel", 132, 820), ranking_row("Mannen Dubbel", 310, 514)
)
JUNIOR_ONLY = ranking_list(
    "164", ranking_row("Mannen Enkel", 141, 774), ranking_row("Mannen Dubbel", 86, 1134), ranking_row("Gemengd Dubbel", 664, 66)
)


def test_discipline_of_maps_every_category_label():
    assert [fer.discipline_of(x) for x in ("Mannen Enkel", "Vrouwen Enkel", "Mannen Dubbel", "Vrouwen Dubbel", "Gemengd Dubbel", "Other")] == [
        "singles",
        "singles",
        "doubles",
        "doubles",
        "mixed",
        None,
    ]


def test_parse_player_page_member_id():
    assert fer.parse_player_page_member_id(PLAYER_PAGE) == "10002752"
    assert fer.parse_player_page_member_id("<html/>") is None


def test_parse_search_profile_guid_requires_the_exact_member_id():
    html = search_item(GUID_B, "100029999") + search_item(GUID_A, "10002752")
    assert fer.parse_search_profile_guid(html, "10002752") == GUID_A
    assert fer.parse_search_profile_guid(html, "1000275") is None
    assert fer.parse_search_profile_guid('<li class="no-results">Geen resultaten</li>', "10002752") is None


def test_parse_profile_ranking_lists_reads_each_list_and_discipline():
    assert fer.parse_profile_ranking_lists(ADULT_AND_JUNIOR) == {
        "75": {"singles": {"rank": 2802, "points": 313}},
        "164": {"singles": {"rank": 132, "points": 820}, "doubles": {"rank": 310, "points": 514}},
    }
    assert fer.parse_profile_ranking_lists(JUNIOR_ONLY)["164"]["mixed"] == {"rank": 664, "points": 66}
    assert fer.parse_profile_ranking_lists("<html/>") == {}
    assert fer.parse_profile_ranking_lists(ranking_list("75", ranking_row("Onbekend", 1, 1))) == {}


def test_pick_ranking_list_prefers_adult_and_never_mixes_lists():
    picked = fer.pick_ranking_list(fer.parse_profile_ranking_lists(ADULT_AND_JUNIOR))
    assert picked == {"singles": {"rank": 2802, "points": 313}}  # no junior doubles mixed in
    assert fer.pick_ranking_list(fer.parse_profile_ranking_lists(JUNIOR_ONLY))["singles"]["rank"] == 141
    assert fer.pick_ranking_list({}) == {}


def test_fetch_member_id_uses_the_lowercase_tournament_player_page(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/player/77": PLAYER_PAGE})
    assert fer.fetch_member_id("D3A701AB-4616", "77", "c=1") == "10002752"
    assert fake.urls == ["https://badmintonnederland.toernooi.nl/tournament/d3a701ab-4616/player/77"]


def test_fetch_ranking_for_member_walks_search_then_profile(monkeypatch):
    sleeps = no_sleep(monkeypatch)
    fake = install_urlopen(monkeypatch, {"DoSearch": search_item(GUID_A, "10002752"), "/ranking": ADULT_AND_JUNIOR})
    assert fer.fetch_ranking_for_member("10002752", "c", 0.5) == {"singles": {"rank": 2802, "points": 313}}
    assert "Query=10002752" in fake.urls[0] and fake.urls[1].endswith(f"/player-profile/{GUID_A}/ranking")
    assert sleeps == [0.5]


def test_fetch_ranking_for_member_without_a_profile_is_empty(monkeypatch):
    fake = install_urlopen(monkeypatch, {"DoSearch": '<li class="no-results">Geen resultaten</li>'})
    assert fer.fetch_ranking_for_member("1", "c", 0) == {}
    assert len(fake.requests) == 1


def test_state_round_trip_and_defaults(tmp_path):
    assert fer.load_state(tmp_path / "none.json") == {"entries": {}, "rankings": {}}
    path = write_json(tmp_path / "s.json", {"entries": {"T:1": "9"}})
    assert fer.load_state(path) == {"entries": {"T:1": "9"}, "rankings": {}}
    fer.save_state(path, {"entries": {"b": "2", "a": "1"}, "rankings": {}})
    assert list(read_json(path)["entries"]) == ["a", "b"]


def test_has_ended_and_priority_put_active_tournaments_first():
    today = date(2026, 10, 5)
    past, current, future, undated = ["2026-09-05 00:00"], ["2026-10-05 00:00"], ["2026-11-01 00:00", "2026-11-02 00:00"], []
    assert fer.has_ended(past, today) and not fer.has_ended(current, today) and not fer.has_ended(undated, today)
    ordered = sorted(
        [("past", past), ("undated", undated), ("future", future), ("current", current)],
        key=lambda item: fer.tournament_priority(item, today),
    )
    assert [tid for tid, _ in ordered] == ["current", "future", "past", "undated"]
    # the user's own tournaments jump the queue, even a finished one
    ordered = sorted(
        [("future", future), ("past", past)],
        key=lambda item: fer.tournament_priority(item, today, frozenset({"past"})),
    )
    assert [tid for tid, _ in ordered] == ["past", "future"]


def test_iter_entrants_orders_by_priority_and_flags_active():
    details = {
        "OLD": {"entries": [{"player_id": "1"}]},
        "NEW": {"entries": [{"player_id": "2"}, {"player_id": "3"}]},
        "BARE": {},
    }
    tournaments = {"OLD": {"dates": ["2026-01-01 00:00"]}, "NEW": {"dates": ["2026-12-01 00:00"]}}
    assert list(fer.iter_entrants(details, tournaments, date(2026, 10, 5))) == [
        ("NEW", "2", True),
        ("NEW", "3", True),
        ("OLD", "1", False),
    ]
    assert [e[0] for e in fer.iter_entrants(details, tournaments, date(2026, 10, 5), frozenset({"OLD"}))] == ["OLD", "NEW", "NEW"]


def test_needs_ranking_only_refreshes_stale_rankings_of_active_tournaments():
    now = datetime(2026, 10, 5, tzinfo=timezone.utc)
    old = (now - timedelta(days=8)).isoformat()
    fresh = (now - timedelta(days=1)).isoformat()
    state = {"rankings": {"old": {"fetched_at": old}, "fresh": {"fetched_at": fresh}}}
    assert fer.needs_ranking(state, "missing", False, now) is True
    assert fer.needs_ranking(state, "old", True, now) is True
    assert fer.needs_ranking(state, "old", False, now) is False
    assert fer.needs_ranking(state, "fresh", True, now) is False


def test_process_entrant_resolves_member_then_ranking(monkeypatch):
    no_sleep(monkeypatch)
    install_urlopen(monkeypatch, {"/player/77": PLAYER_PAGE, "DoSearch": search_item(GUID_A, "10002752"), "/ranking": ADULT_AND_JUNIOR})
    state = {"entries": {}, "rankings": {}}
    now = datetime(2026, 10, 5, tzinfo=timezone.utc)
    assert fer.process_entrant(state, "T", "77", True, "c", 0, now) is True
    assert state["entries"] == {"T:77": "10002752"}
    assert state["rankings"]["10002752"] == {"fetched_at": "2026-10-05T00:00:00+00:00", "ranking": {"singles": {"rank": 2802, "points": 313}}}


def test_process_entrant_does_nothing_when_already_resolved_and_fresh(monkeypatch):
    fake = install_urlopen(monkeypatch, {})
    now = datetime(2026, 10, 5, tzinfo=timezone.utc)
    state = {"entries": {"T:77": "9"}, "rankings": {"9": {"fetched_at": now.isoformat(), "ranking": {}}}}
    assert fer.process_entrant(state, "T", "77", True, "c", 0, now) is False
    assert fake.requests == []


def test_process_entrant_leaves_an_entry_without_member_id_unresolved(monkeypatch):
    no_sleep(monkeypatch)
    install_urlopen(monkeypatch, {"/player/5": "<html/>"})
    state = {"entries": {}, "rankings": {}}
    assert fer.process_entrant(state, "T", "5", True, "c", 0, datetime.now(timezone.utc)) is True
    assert state == {"entries": {}, "rankings": {}}


def test_process_entrant_reuses_a_known_member_for_another_tournament(monkeypatch):
    no_sleep(monkeypatch)
    fake = install_urlopen(monkeypatch, {"/player/8": PLAYER_PAGE})
    now = datetime(2026, 10, 5, tzinfo=timezone.utc)
    state = {"entries": {}, "rankings": {"10002752": {"fetched_at": now.isoformat(), "ranking": {}}}}
    assert fer.process_entrant(state, "T2", "8", True, "c", 0, now) is True
    assert state["entries"] == {"T2:8": "10002752"} and len(fake.requests) == 1  # no second ranking fetch


def test_run_respects_the_limit_saves_progress_and_survives_failures(monkeypatch, tmp_path, capsys):
    no_sleep(monkeypatch)
    monkeypatch.setattr(fer, "SAVE_EVERY", 2)
    install_urlopen(monkeypatch, {"/player/1": url_error("down"), "/player/2": "<html/>", "/player/3": "<html/>", "/player/4": "<html/>"})
    state = {"entries": {}, "rankings": {}}
    entrants = iter([("T", str(i), True) for i in range(1, 5)])
    state_path = tmp_path / "state.json"
    assert fer.run(state, entrants, "c", 3, 0, state_path) == 3
    out = capsys.readouterr().out
    assert "FAILED T:1" in out and "[2/3] progress saved" in out
    assert state_path.exists()


def test_main_runs_and_reports_summary(monkeypatch, tmp_path, capsys):
    patch_io(monkeypatch, fer, {"/player/77": PLAYER_PAGE, "DoSearch": search_item(GUID_A, "10002752"), "/ranking": ADULT_AND_JUNIOR})
    details = write_json(tmp_path / "details.json", {"T": {"entries": [{"player_id": "77"}]}})
    monkeypatch.setattr(fer, "DETAILS_PATH", details)
    monkeypatch.setattr(fer, "TOURNAMENTS_PATH", tmp_path / "none.json")
    monkeypatch.setattr(fer, "STATE_PATH", tmp_path / "state.json")
    monkeypatch.setattr(fer, "MY_TOURNAMENTS_PATH", write_json(tmp_path / "mine.json", ["T"]))
    run_main(monkeypatch, fer, "--cookie-file", str(write_cookie(tmp_path)), "--delay", "0")
    assert "Done. 1 entrants worked on, 1 resolved to a MemberID, 1/1 of those with a national ranking" in capsys.readouterr().out
    assert read_json(tmp_path / "state.json")["entries"] == {"T:77": "10002752"}


def test_main_exits_with_nothing_to_do_when_there_is_no_work(monkeypatch, tmp_path):
    patch_io(monkeypatch, fer)
    monkeypatch.setattr(fer, "DETAILS_PATH", tmp_path / "none.json")
    monkeypatch.setattr(fer, "TOURNAMENTS_PATH", tmp_path / "none2.json")
    monkeypatch.setattr(fer, "STATE_PATH", tmp_path / "state.json")
    with pytest.raises(SystemExit) as exc:
        run_main(monkeypatch, fer, "--cookie-file", str(write_cookie(tmp_path)))
    assert exc.value.code == fer.NOTHING_TO_DO
