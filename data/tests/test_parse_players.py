import json
import sys

import pytest

import parse_players as pp
from helpers_parsers import player_link, strong


def stats_row(rank, pid, name, team, won, played):
    return (
        f'<tr><td>{rank}</td><td><a href="player.aspx?id=T&player={pid}">{name}</a></td>'
        f'<td><a href="teamplayerstats.aspx?id=T&team=3">{team}</a></td><td>{won}</td><td>{played}</td></tr>'
    )


def rubber_row(code, home, away, score="<b>21-15</b> <i>21-10</i>"):
    return (
        f'<tr><td>{code}</td><td align="right"><table align="Right">{home}</table></td>'
        f'<td align="center">-</td><td><table>{away}</table></td><td><span class="score">{score}</span></td></tr>'
    )


def match_page(*rows, header='<h3><a href="m.aspx?team=1">Home &amp; BC</a> - <a href="m.aspx?team=2">Away BC</a></h3>'):
    return f"<html><body>{header}<table>{''.join(rows)}</table></body></html>"


JAN, PIET, KEES, HENK = ("1", "Jan"), ("2", "Piet"), ("3", "Kees"), ("4", "Henk")


def links(*players, winner=False):
    rendered = [player_link(pid, name) for pid, name in players]
    return " ".join(strong(r) if winner else r for r in rendered)


@pytest.fixture
def pages_dir(tmp_path):
    (tmp_path / "playerstats.html").write_text(
        "<table>"
        + stats_row(1, 1, "Jan", "Team &amp; A", 7, 9)
        + stats_row(2, 2, "Piet", "Team B", 3, 8)
        + stats_row(3, 5, "Dave", "Team A", 1, 1)
        + "</table>",
        encoding="utf-8",
    )
    page = match_page(
        rubber_row("MS1", links(JAN, winner=True), links(PIET)),
        rubber_row("MD1", links(JAN, KEES), links(PIET, HENK, winner=True)),
        rubber_row("MS2", links(("9", "Zed")), links(("8", "Yan"))),
    )
    (tmp_path / "match_100.html").write_text(page, encoding="utf-8")
    return tmp_path


def test_parse_overall_stats(pages_dir):
    players = pp.parse_overall_stats(pages_dir / "playerstats.html")

    assert set(players) == {"1", "2", "5"}
    jan = players["1"]
    assert (jan.name, jan.team, jan.overall_rank, jan.overall_won, jan.overall_played) == ("Jan", "Team & A", 1, 7, 9)


@pytest.mark.parametrize(
    "html,expected",
    [
        ('<h3><a href="x?team=1">A &amp; B</a> - <a href="x?team=2">C</a>', ("A & B", "C")),
        ("<h3>nothing</h3>", ("Home", "Away")),
    ],
)
def test_extract_team_names(html, expected):
    assert pp.extract_team_names(html) == expected


def test_parse_match_file_skips_unplayed_rubbers(pages_dir):
    rubbers = pp.parse_match_file(pages_dir / "match_100.html")

    assert [r.rubber for r in rubbers] == ["MS1", "MD1"]
    singles, doubles = rubbers
    assert singles.match_id == "100"
    assert singles.round_teams == ("Home & BC", "Away BC")
    assert singles.winner_side == "home"
    assert singles.game_scores == "21-15 21-10"
    assert doubles.winner_side == "away"
    assert doubles.home_players == [JAN, KEES]
    assert doubles.away_players == [PIET, HENK]


def test_register_rubber_players_creates_and_files_by_discipline():
    players = {"1": pp.PlayerRecord(player_id="1", name="Jan")}
    singles = pp.RubberResult("m", ("H", "A"), "MS1", [JAN], [PIET], "home", "21-0")
    doubles = pp.RubberResult("m", ("H", "A"), "MD1", [JAN, KEES], [PIET, HENK], "away", "0-21")

    pp.register_rubber_players(players, singles)
    pp.register_rubber_players(players, doubles)

    assert set(players) == {"1", "2", "3", "4"}
    assert players["1"].singles == [singles] and players["1"].doubles == [doubles]
    assert players["2"].singles == [singles] and players["4"].doubles == [doubles]
    assert players["2"].team == ""


def test_build_database_without_playerstats_page(tmp_path):
    (tmp_path / "match_1.html").write_text(match_page(rubber_row("MS1", links(JAN), links(PIET, winner=True))), encoding="utf-8")

    players = pp.build_database(tmp_path)

    assert set(players) == {"1", "2"}
    assert players["2"].singles_record() == (1, 1)
    assert players["1"].singles_record() == (0, 1)


def test_build_database_merges_overall_stats_and_matches(pages_dir):
    players = pp.build_database(pages_dir)

    assert set(players) == {"1", "2", "3", "4", "5"}
    assert players["1"].overall_rank == 1
    assert players["1"].singles_record() == (1, 1)
    assert players["1"].doubles_record() == (0, 1)
    assert players["4"].doubles_record() == (1, 1)
    assert players["5"].singles_record() == (0, 0)


def test_to_json_reports_opponents_partners_and_results(pages_dir):
    data = pp.to_json(pp.build_database(pages_dir))

    jan, piet, henk = data["1"], data["2"], data["4"]
    assert jan["overall_won_played"] == [7, 9]
    assert jan["singles_won_played"] == [1, 1]
    assert jan["singles_matches"][0] == {
        "match_id": "100",
        "teams": ("Home & BC", "Away BC"),
        "opponent": "Piet",
        "won": True,
        "score": "21-15 21-10",
    }
    assert piet["singles_matches"][0]["opponent"] == "Jan"
    assert piet["singles_matches"][0]["won"] is False
    assert jan["doubles_matches"][0]["partner"] == "Kees"
    assert jan["doubles_matches"][0]["opponents"] == ["Piet", "Henk"]
    assert jan["doubles_matches"][0]["won"] is False
    assert henk["doubles_matches"][0]["partner"] == "Piet"
    assert henk["doubles_matches"][0]["opponents"] == ["Jan", "Kees"]
    assert henk["doubles_matches"][0]["won"] is True


def run_main(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["parse_players.py", *map(str, argv)])
    pp.main()


def test_main_prints_leaderboard_without_players_lacking_singles(monkeypatch, capsys, pages_dir):
    run_main(monkeypatch, pages_dir)

    out = capsys.readouterr().out
    assert "Men's Singles performance (5 players" in out
    assert "singles: 1-0  (rank overall: 1)" in out
    assert out.index("Jan") < out.index("Piet")
    assert "Dave" not in out


def test_main_writes_json_output(monkeypatch, capsys, pages_dir):
    target = pages_dir / "out.json"

    run_main(monkeypatch, pages_dir, "--json", target)

    assert "Wrote 5 players" in capsys.readouterr().out
    assert json.loads(target.read_text(encoding="utf-8"))["1"]["name"] == "Jan"


def test_main_player_filter_prints_only_matches_and_skips_leaderboard(monkeypatch, capsys, pages_dir):
    run_main(monkeypatch, pages_dir, "--player", "KEES")

    out = capsys.readouterr().out
    assert json.loads(out)["3"]["name"] == "Kees"
    assert "Men's Singles" not in out
