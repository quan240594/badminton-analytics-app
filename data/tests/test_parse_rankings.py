import json

import pytest

import parse_rankings as pr


def summary_row(category, rank, points):
    return (
        f'<tr><td><a href="category.aspx?id=1&category={category}">Cat</a></td>'
        f'<td class="rank"><div style="">{rank}</div></td><td>x</td>'
        f'<td class="right rankingpoints">{points}</td></tr>'
    )


def top_row(name, points, rank=1):
    return (
        f'<tr><td class="rank"><div style="">{rank}</div></td><td>flag</td>'
        f'<td><a href="player.aspx?id=1&player=7">{name}</a></td><td>2001</td>'
        f'<td class="right rankingpoints">{points}</td></tr>'
    )


def write(path, *rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("<table>" + "\n".join(rows) + "</table>", encoding="utf-8")
    return path


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_parse_player_file_maps_categories_to_disciplines(tmp_path):
    path = write(
        tmp_path / "p.html",
        summary_row("491", 5, 120),
        summary_row("494", 7, 80),
        summary_row("495", 1, 300),
        summary_row("999", 2, 10),
    )

    assert pr.parse_player_file(path) == {
        "singles": {"rank": 5, "points": 120},
        "doubles": {"rank": 7, "points": 80},
        "mixed": {"rank": 1, "points": 300},
    }


def test_parse_player_file_without_rows_is_empty(tmp_path):
    assert pr.parse_player_file(write(tmp_path / "p.html", "<td>nothing</td>")) == {}


def test_parse_top_player(tmp_path):
    path = write(tmp_path / "c.html", top_row("Runner Up", 90, rank=2), top_row("Champ", 500))

    assert pr.parse_top_player(path) == {"name": "Champ", "points": 500}


def test_parse_top_player_without_leader_returns_none(tmp_path):
    assert pr.parse_top_player(write(tmp_path / "c.html", top_row("Runner Up", 90, rank=2))) is None


def test_load_existing(tmp_path):
    out = tmp_path / "rankings.json"
    assert pr.load_existing(out) == ({}, {})

    out.write_text(json.dumps({"players": {"1": {}}, "top": {"mixed": {"name": "X"}}}), encoding="utf-8")
    assert pr.load_existing(out) == ({"1": {}}, {"mixed": {"name": "X"}})

    out.write_text("{}", encoding="utf-8")
    assert pr.load_existing(out) == ({}, {})


def test_main_merges_new_pages_into_existing_rankings(workdir, capsys):
    (workdir / "rankings.json").write_text(
        json.dumps({"players": {"99": {"singles": {"rank": 1, "points": 1}}}, "top": {"mixed": {"name": "Old", "points": 5}}}),
        encoding="utf-8",
    )
    rankings = workdir / "pages" / "rankings"
    write(rankings / "player_12.html", summary_row("491", 3, 150))
    write(rankings / "player_13.html", "<td>no ranking data</td>")
    write(rankings / "category_491.html", top_row("Champ", 500))
    write(rankings / "category_493.html", top_row("Rank Two", 10, rank=2))

    pr.main()

    result = json.loads((workdir / "rankings.json").read_text(encoding="utf-8"))
    assert set(result["players"]) == {"99", "12"}
    assert result["players"]["12"] == {"singles": {"rank": 3, "points": 150}}
    assert result["top"] == {"mixed": {"name": "Old", "points": 5}, "singles": {"name": "Champ", "points": 500}}
    out = capsys.readouterr().out
    assert "Parsed 1 players with ranking data this run (2 total)" in out
    assert "Top players:" in out


def test_main_without_pages_writes_empty_database(workdir, capsys):
    pr.main()

    assert json.loads((workdir / "rankings.json").read_text(encoding="utf-8")) == {"players": {}, "top": {}}
    assert "Parsed 0 players" in capsys.readouterr().out
