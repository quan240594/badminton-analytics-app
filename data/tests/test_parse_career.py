import pytest

import parse_career as pc
from helpers_parsers import (
    classic_player_page,
    classic_row,
    classic_side,
    new_template_item,
    new_template_player,
    player_link,
    strong,
    team_link,
)


@pytest.fixture(autouse=True)
def canonical_clubs(monkeypatch):
    monkeypatch.setattr(pc, "_CANONICAL_CLUB_NAMES", {"drop shot bc": "DROP SHOT BC", "bbs bodegraven": "BBS BODEGRAVEN"})


def write_page(tmp_path, html, name="player_1.html"):
    path = tmp_path / name
    path.write_text(html, encoding="utf-8")
    return path


@pytest.mark.parametrize("raw,expected", [("<b> hi </b>", "hi"), ("plain", "plain"), ("<a href='x'>A</a><br/>B", "AB")])
def test_strip_tags(raw, expected):
    assert pc.strip_tags(raw) == expected


@pytest.mark.parametrize("home,away,expected", [(True, False, "home"), (False, True, "away"), (False, False, ""), (True, True, "home")])
def test_winner_side_of(home, away, expected):
    assert pc.winner_side_of(home, away) == expected


@pytest.mark.parametrize(
    "block,team,players,won",
    [
        (strong(team_link("Team &amp; Co")) + player_link("1", "A"), "Team & Co", [("1", "A")], True),
        (team_link("Plain") + player_link("2", "B &amp; C"), "Plain", [("2", "B & C")], False),
        (strong(player_link("3", "Cee")), "", [("3", "Cee")], True),
        ("nothing here", "", [], False),
    ],
)
def test_parse_side(block, team, players, won):
    assert pc.parse_side(block) == (team, players, won)


@pytest.mark.parametrize(
    "club,expected",
    [
        (None, None),
        ("  BBS ", "BBS BODEGRAVEN"),
        ("drop shot bc", "DROP SHOT BC"),
        ("Unknown Club", "Unknown Club"),
    ],
)
def test_normalize_club(club, expected):
    assert pc.normalize_club(club) == expected


def test_parse_player_file_classic_template(tmp_path):
    rows = (
        classic_row(
            classic_side("Home BC", [("1", "Jan Jansen")], winner="team"),
            classic_side("Away BC", [("2", "Piet Pietersen")]),
            score="21-15 <b>21-10</b>",
        ),
        classic_row(
            classic_side("Home BC", [("1", "Jan Jansen"), ("3", "Kees")]),
            classic_side("Away BC", [("2", "Piet"), ("4", "Henk")], winner="player"),
            event="MD",
        ),
        classic_row(classic_side(players=[("1", "Jan Jansen")]), classic_side(players=[("2", "Piet")])),
    )
    path = write_page(tmp_path, classic_player_page(name="Jan &amp; Jansen", club="Drop Shot BC", rows=rows))

    info = pc.parse_player_file(path, "TID", "1")

    assert (info.tournament_id, info.player_id) == ("TID", "1")
    assert info.name == "Jan & Jansen"
    assert info.profile_guid == "AB12-cd34"
    assert info.member_id == "1234567"
    assert info.club == "DROP SHOT BC"
    assert [m.winner_side for m in info.matches] == ["home", "away", ""]
    first = info.matches[0]
    assert first.source_player_id == "1"
    assert (first.time, first.event, first.draw, first.score) == ("Mon 01-09-2025", "MS", "Afd 1A", "21-15 21-10")
    assert (first.home_team, first.away_team) == ("Home BC", "Away BC")
    assert first.home_players == [("1", "Jan Jansen")]
    assert info.matches[1].away_players == [("2", "Piet"), ("4", "Henk")]


def test_parse_player_file_without_metadata_falls_back(tmp_path):
    path = write_page(tmp_path, classic_player_page(name=None, member_id=None, club=None, overview=True), name="player_77.html")

    info = pc.parse_player_file(path, "TID", "77")

    assert (info.name, info.profile_guid, info.member_id, info.club) == ("player_77", None, None, None)
    assert info.matches == []


def test_parse_player_file_uses_new_template_without_overview(tmp_path):
    item = new_template_item(home=[("1", "Jan")], away=[("2", "Piet")], home_won=True)
    path = write_page(tmp_path, classic_player_page(overview=False, extra=item))

    info = pc.parse_player_file(path, "TID", "1")

    assert len(info.matches) == 1
    assert info.matches[0].winner_side == "home"


def test_new_template_matches_full_card():
    html = "<ul>" + new_template_item(home=[("1", "Jan"), ("3", "Kees")], away=[("2", "Piet &amp; Co")], away_won=True) + "</ul>"

    (match,) = pc.parse_new_template_matches(html, "TID", "1")

    assert match.event == "MS A"
    assert match.time == "Mon 01/09/2025 20:00"
    assert match.home_players == [("1", "Jan"), ("3", "Kees")]
    assert match.away_players == [("2", "Piet & Co")]
    assert match.score == "21-15 21-10"
    assert match.winner_side == "away"
    assert (match.tournament_id, match.source_player_id, match.draw) == ("TID", "1", "")


def test_new_template_matches_missing_optional_parts():
    html = new_template_item(home=[("1", "Jan")], away=[("2", "Piet")], draw=None, time=None, sets=())

    (match,) = pc.parse_new_template_matches(html, "TID", "1")

    assert (match.event, match.time, match.score, match.winner_side) == ("", "", "", "")


def test_new_template_matches_skip_unusable_cards():
    bad_ul = '<ul class="points"><li class="points__cell">1</li></ul>'
    bye = '<li class="match-group__item"><div class="match__row">' + new_template_player("1", "Jan") + "</div></li>"
    no_players = new_template_item(home=[], away=[("2", "Piet")])
    ok = new_template_item(home=[("1", "Jan")], away=[("2", "Piet")], sets=(), extra_ul=bad_ul)

    matches = pc.parse_new_template_matches("preamble" + bye + no_players + ok, "TID", "1")

    assert len(matches) == 1
    assert matches[0].score == ""


def test_new_template_matches_without_cards_is_empty():
    assert pc.parse_new_template_matches("<html></html>", "T", "1") == []


@pytest.mark.parametrize("raw,expected", [
    ("Noah \\&amp;#039;t Jong", "Noah 't Jong"),
    ("d\\&#039;Coutho", "d'Coutho"),
    ("Piet &amp; Co", "Piet & Co"),
    ("Plain Name", "Plain Name"),
])
def test_decode_name_handles_the_sites_double_encoded_apostrophes(raw, expected):
    assert pc.decode_name(raw) == expected


def test_new_template_matches_decode_double_encoded_names():
    html = new_template_item(home=[("1", "Noah \\&amp;#039;t Jong")], away=[("2", "Piet")], home_won=True)

    (match,) = pc.parse_new_template_matches(html, "TID", "1")

    assert match.home_players == [("1", "Noah 't Jong")]
