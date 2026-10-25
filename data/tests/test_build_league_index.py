import json

import pytest

import build_league_index as bli


@pytest.mark.parametrize(
    "name,expected",
    [
        ("DROP SHOT BC M1", "DROP SHOT BC"),
        ("Drop Shot BC  1", "DROP SHOT BC"),
        ("  Foo    Bar  ", "FOO BAR"),
        ("Club 12", "CLUB"),
        ("Plain", "PLAIN"),
    ],
)
def test_normalize(name, expected):
    assert bli.normalize(name) == expected


CLUBS = {
    "c1": {"name": "Drop Shot BC", "city": "Utrecht"},
    "c2": {"name": "Zeist Smash", "city": "Zeist"},
    "c3": {"name": "Noordster", "city": "Groningen"},
    "c4": {"name": "Cityless", "city": None},
}


def draw(division, label, *teams):
    return {"division": division, "afdelingLabel": label, "teams": list(teams)}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(bli, "DATA_DIR", tmp_path)
    return tmp_path


def run(data_dir, draw_teams):
    (data_dir / "clubs.json").write_text(json.dumps(CLUBS), encoding="utf-8")
    (data_dir / "draw_teams.json").write_text(json.dumps(draw_teams), encoding="utf-8")
    bli.main()
    return json.loads((data_dir / "league_index.json").read_text(encoding="utf-8"))


def test_main_builds_region_division_tree(data_dir, capsys):
    result = run(
        data_dir,
        {
            "d1": draw("Eredivisie", "B", "Drop Shot BC 1", "Zeist Smash M2", "Noordster 3", "Ghost Team"),
            "d2": draw("Eredivisie", "A", "Noordster 1"),
            "d3": draw("1e Divisie", "A", "Cityless 1"),
        },
    )

    assert result["regions"] == ["Midden", "Noord", "Onbekend"]
    assert list(result["divisions"]) == ["1e Divisie", "Eredivisie"]
    assert [a["label"] for a in result["divisions"]["Eredivisie"]] == ["A", "B"]
    majority = result["divisions"]["Eredivisie"][1]
    assert (majority["drawId"], majority["region"]) == ("d1", "Midden")
    assert majority["teams"][0] == {"name": "Drop Shot BC 1", "clubId": "c1", "city": "Utrecht"}
    assert majority["teams"][3] == {"name": "Ghost Team", "clubId": None, "city": None}
    assert result["divisions"]["1e Divisie"][0]["region"] == "Onbekend"

    out = capsys.readouterr().out
    assert "wrote league_index.json: 3 afdelingen across 2 divisions, 3 regions" in out
    assert "1 team names could not be matched to a club" in out
    assert " - Ghost Team" in out


def test_main_omits_unmatched_section_when_all_teams_match(data_dir, capsys):
    run(data_dir, {"d1": draw("Eredivisie", "A", "Noordster 1")})

    assert "could not be matched" not in capsys.readouterr().out
