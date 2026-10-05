import fetch_tournament_draw as ftd
from helpers_fetchers import header_map, install_urlopen, patch_io, read_json, run_main, write_cookie, write_json


def standing_row(rank, players, cells):
    names = "".join(f'<a href="/Player/{pid}" x><span class="nav-link__value">{name}</span></a>' for pid, name in players)
    points = "".join(f'<td class="cell-points">{value}</td>' for value in cells)
    return f'<tr><td><span class="standing-status">{rank}</span></td><td class="sticky-col-2 y">{names}</td>{points}</tr>'


def side(won, players):
    flag = " has-won" if won else " "
    body = "".join(f'<a data-player-id="{pid}" data-nationality-id="NED" x><span class="nav-link__value">{name}</span></a>' for pid, name in players)
    return f'<div class="match__row{flag}">{body}</div>'


def match_block(match_id, sides, round_title="", games=(), date="", member_ids=()):
    parts = [f'<li class="match-group__item" id="match_{match_id}">']
    if round_title:
        parts.append(f'<span title="{round_title}"></span>')
    parts.extend(sides)
    parts.extend(f'<ul class="points"><li class="points__cell a">{a}</li><li class="points__cell">{b}</li></ul>' for a, b in games)
    parts.extend(f'<a href="x?T1P{i}MemberID={mid}">h2h</a>' for i, mid in enumerate(member_ids, 1))
    if date:
        parts.append(f'<div class="match__footer"><span class="nav-link__value">{date}</span></div>')
    return "".join(parts)


STANDINGS = standing_row(1, [("10", "Jan"), ("11", "Piet")], ["3", "2", "0", "1", "2-1", "4-2", "84-70", "-5"]) + standing_row(2, [("12", "Kees")], ["x"])
MATCHES = (
    "<ul>"
    + match_block(
        1,
        [side(True, [("10", "Jan"), ("11", "Piet")]), side(False, [("12", "Kees")])],
        round_title="Ronde 1",
        games=[(21, 15), (21, 18)],
        date="Za 13-9-2025 14:30",
        member_ids=("900", "901", "902"),
    )
    + match_block(2, [side(False, [])])
)


def test_parse_standings():
    assert ftd.parse_standings(STANDINGS) == [
        {
            "rank": 1,
            "players": [{"player_id": "10", "name": "Jan"}, {"player_id": "11", "name": "Piet"}],
            "played": 3, "won": 2, "drawn": 0, "lost": 1,
            "match_record": "2-1", "game_record": "4-2", "points_record": "84-70", "ranking_points": -5,
        },
        {"rank": 2, "players": [{"player_id": "12", "name": "Kees"}], "played": "x"},
    ]


def test_parse_standings_empty():
    assert ftd.parse_standings("<html/>") == []


def test_parse_matches():
    full, bare = ftd.parse_matches(MATCHES)
    assert full == {
        "match_id": "1",
        "round": "Ronde 1",
        "sides": [
            {"won": True, "players": [{"player_id": "10", "name": "Jan", "member_id": "900"}, {"player_id": "11", "name": "Piet", "member_id": "901"}]},
            {"won": False, "players": [{"player_id": "12", "name": "Kees", "member_id": "902"}]},
        ],
        "games": [[21, 15], [21, 18]],
        "played_at": "Za 13-9-2025 14:30",
    }
    assert bare == {"match_id": "2", "round": None, "sides": [{"won": False, "players": []}], "games": [], "played_at": None}


def test_parse_matches_empty():
    assert ftd.parse_matches("no matches") == []


def test_fetch_sends_xhr_headers_and_cookie(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/x": "body"})
    assert ftd.fetch("http://h/x", "c=1") == "body"
    headers = header_map(fake.requests[0])
    assert headers["cookie"] == "c=1" and headers["x-requested-with"] == "XMLHttpRequest"


def test_fetch_draw_requests_both_xhrs_with_lowercase_tournament_id(monkeypatch):
    fake = install_urlopen(monkeypatch, {"GetStandings": STANDINGS, "GetMatchesContent": MATCHES})
    draw = ftd.fetch_draw("AB-CD", "7", "c")
    assert fake.urls == [
        "https://badmintonnederland.toernooi.nl/tournament/ab-cd/Draw/7/GetStandings?X-Requested-With=XMLHttpRequest",
        "https://badmintonnederland.toernooi.nl/tournament/ab-cd/Draw/7/GetMatchesContent?tabindex=1&X-Requested-With=XMLHttpRequest",
    ]
    assert len(draw["standings"]) == 2 and len(draw["matches"]) == 2


def test_main_merges_draw_into_output(monkeypatch, tmp_path, capsys):
    patch_io(monkeypatch, ftd, {"GetStandings": STANDINGS, "GetMatchesContent": MATCHES})
    out = write_json(tmp_path / "draws.json", {"OTHER": {"1": {"standings": [], "matches": []}}})
    run_main(monkeypatch, ftd, "ab-cd", "7", "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out))
    saved = read_json(out)
    assert saved["OTHER"] == {"1": {"standings": [], "matches": []}}
    assert len(saved["AB-CD"]["7"]["matches"]) == 2
    assert "Done. 2 standings rows, 2 matches for draw 7" in capsys.readouterr().out


def test_main_creates_output_file(monkeypatch, tmp_path):
    patch_io(monkeypatch, ftd, {"GetStandings": "", "GetMatchesContent": ""})
    out = tmp_path / "new.json"
    run_main(monkeypatch, ftd, "T", "1", "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out))
    assert read_json(out) == {"T": {"1": {"standings": [], "matches": []}}}


def test_parsers_decode_html_entities_in_player_names_and_rounds():
    standings = ftd.parse_standings(standing_row(1, [("10", "Dieudonn&#233;e Den Dulk")], ["1"]))
    assert standings[0]["players"][0]["name"] == "Dieudonn\u00e9e Den Dulk"
    matches = ftd.parse_matches("<ul>" + match_block(1, [side(True, [("10", "Bj&#246;rn")])], round_title="Ronde &amp; 1"))
    assert matches[0]["sides"][0]["players"][0]["name"] == "Bj\u00f6rn"
    assert matches[0]["round"] == "Ronde & 1"


def test_parse_matches_reads_players_whose_link_has_more_attributes():
    link = '<a href="/x" data-player-id="73" data-club-id="28" data-nationality-id="" class="nav-link"><span class="nav-link__value">Dmytro</span> </a>'
    [match] = ftd.parse_matches('<li class="match-group__item" id="match_1"><div class="match__row has-won">' + link + "</div>")
    assert match["sides"] == [{"won": True, "players": [{"player_id": "73", "name": "Dmytro"}]}]


def test_parse_matches_reads_knockout_round_names_seeds_and_byes():
    rounds = ["Ronde van 64", "Kwartfinale", "Halve finale", "Finale"]
    blocks = "".join(match_block(i, [side(False, [("1", "A")])], round_title=r) for i, r in enumerate(rounds))
    assert [m["round"] for m in ftd.parse_matches(blocks)] == rounds

    seeded = side(True, [("48", "Tristan Paap [1]"), ("49", "Sam Jansen [3/4]")])
    bye = '<div class="match__row "><span> Bye </span></div>'
    [match] = ftd.parse_matches(match_block(5, [seeded, bye]))
    assert match["sides"] == [
        {"won": True, "players": [{"player_id": "48", "name": "Tristan Paap", "seed": 1}, {"player_id": "49", "name": "Sam Jansen", "seed": 3}]},
        {"won": False, "players": [], "bye": True},
    ]
