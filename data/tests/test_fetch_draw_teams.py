import pytest

from helpers_fetchers import header_map, install_urlopen, load_module, patch_io, read_json, run_main, url_error, write_cookie, write_json


def draw_link(draw_id, label):
    return f'<a href="draw.aspx?id=AB-12&draw={draw_id}" class="d">{label}</a>'


def team_link(name):
    return f'<a class="t" href="teammatch.aspx?id=T&match=1" x>{name}</a>'


@pytest.fixture
def draw_teams(monkeypatch, tmp_path):
    return load_module(monkeypatch, tmp_path, "fetch_draw_teams")


def run(monkeypatch, module, tmp_path, *extra):
    cookie = write_cookie(tmp_path)
    run_main(monkeypatch, module, "--cookie-file", str(cookie), "--out", str(tmp_path / "draws.json"), *extra)
    return tmp_path / "draws.json"


def test_fetch_sends_cookie(monkeypatch, draw_teams):
    fake = install_urlopen(monkeypatch, {"/x": "body"})
    assert draw_teams.fetch("http://h/x", "c=1") == "body"
    assert header_map(fake.requests[0])["cookie"] == "c=1"


def test_main_collects_team_names_per_draw(monkeypatch, draw_teams, tmp_path, capsys):
    listing = (
        draw_link(1, "Bondscompetitie – 1e divisie – Afd. 1A")
        + draw_link(2, "Only – Two")
        + draw_link(3, " Plain label ")
        + draw_link(4, "Cached – Old – Afd. 9")
        + draw_link(5, "Broken – Draw – Afd. 7")
    )
    teams_html = (
        team_link("Alpha 1") + team_link("Alpha 2") + team_link("Beta") + team_link("Modify") + team_link("  ") + team_link("Gamma   12")
    )
    fake, sleeps = patch_io(
        monkeypatch,
        draw_teams,
        {"draws.aspx": listing, "draw=5": url_error("timeout"), "draw=": teams_html},
    )
    write_json(tmp_path / "draws.json", {"4": {"division": "old", "afdelingLabel": "old", "teams": []}})
    out = run(monkeypatch, draw_teams, tmp_path, "--delay", "0.2")
    printed = capsys.readouterr().out
    data = read_json(out)
    assert data["1"] == {"division": "1e divisie", "afdelingLabel": "Afd. 1A", "teams": ["Alpha", "Beta", "Gamma"]}
    assert data["2"]["division"] == "Two" and data["2"]["afdelingLabel"] == "Only – Two"
    assert data["3"]["division"] == "Plain label" and data["3"]["afdelingLabel"] == "Plain label"
    assert data["4"]["division"] == "old"
    assert "5" not in data
    assert "[5/5] FAILED draw=5 -> <urlopen error timeout>" in printed
    assert "found 5 draws" in printed and "done. wrote 4 draws" in printed
    assert sleeps == [0.2, 0.2, 0.2]
    assert fake.urls[0].endswith("draws.aspx?id=" + draw_teams.CURRENT_TOURNAMENT_ID)
    assert "drawmatches.aspx?id=AB-12&draw=1" in fake.urls[1]


def test_main_logs_progress_every_10_draws(monkeypatch, draw_teams, tmp_path, capsys):
    listing = "".join(draw_link(100 + i, f"X – Div {i} – Afd. {i}") for i in range(10))
    patch_io(monkeypatch, draw_teams, {"draws.aspx": listing, "draw=": team_link("Solo 1")})
    out = run(monkeypatch, draw_teams, tmp_path)
    assert "[10/10] draw=109 Afd. 9 -> 1 teams" in capsys.readouterr().out
    assert len(read_json(out)) == 10
