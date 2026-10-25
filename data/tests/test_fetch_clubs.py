import pytest

from helpers_fetchers import header_map, install_urlopen, load_module, patch_io, read_json, run_main, url_error, write_cookie, write_json

ADDRESS = '<th>Address:</th><td class="x"><table class="clean"><tr><td> {} </td></tr></table></td>'


def club_link(club_id, name):
    return f'<a class="c" href="club.aspx?id=T&club={club_id}" x>{name}</a>'


@pytest.fixture
def clubs(monkeypatch, tmp_path):
    return load_module(monkeypatch, tmp_path, "fetch_clubs")


def run(monkeypatch, clubs, tmp_path, *extra):
    cookie = write_cookie(tmp_path)
    run_main(monkeypatch, clubs, "--cookie-file", str(cookie), "--out", str(tmp_path / "clubs.json"), *extra)
    return tmp_path / "clubs.json"


def test_uses_default_season_id_without_events_index(clubs):
    assert clubs.CURRENT_TOURNAMENT_ID == "9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E"


def test_fetch_sends_cookie(monkeypatch, clubs):
    fake = install_urlopen(monkeypatch, {"/x": "body"})
    assert clubs.fetch("http://h/x", "c=1") == "body"
    assert header_map(fake.requests[0])["cookie"] == "c=1"


def test_main_fetches_skips_and_records_failures(monkeypatch, clubs, tmp_path, capsys):
    listing = club_link(11, "Club A") + club_link(12, " Club B ") + club_link(13, "Club C") + club_link(14, "Club D")
    fake, sleeps = patch_io(
        monkeypatch,
        clubs,
        {"clubs.aspx": listing, "club=12": ADDRESS.format("Utrecht"), "club=13": url_error("gone"), "club=14": "<html>no address</html>"},
    )
    write_json(tmp_path / "clubs.json", {"11": {"name": "Club A", "city": "Delft"}, "12": {"name": "Club B", "city": None}})
    out = run(monkeypatch, clubs, tmp_path, "--delay", "0.4")
    printed = capsys.readouterr().out
    assert "found 4 clubs" in printed
    assert "[3/4] FAILED club=13 (Club C) -> <urlopen error gone>" in printed
    assert "done. wrote 3 clubs" in printed
    assert read_json(out) == {
        "11": {"name": "Club A", "city": "Delft"},
        "12": {"name": "Club B", "city": "Utrecht"},
        "14": {"name": "Club D", "city": None},
    }
    assert sleeps == [0.4, 0.4]
    assert "clubs.aspx?id=" + clubs.CURRENT_TOURNAMENT_ID in fake.urls[0]


def test_main_logs_progress_and_checkpoints_every_20_clubs(monkeypatch, clubs, tmp_path, capsys):
    listing = "".join(club_link(100 + i, f"Club {i}") for i in range(20))
    patch_io(monkeypatch, clubs, {"clubs.aspx": listing, "club=": ADDRESS.format("Town")})
    out = run(monkeypatch, clubs, tmp_path)
    assert "[20/20] fetched club=119 Club 19 -> Town" in capsys.readouterr().out
    assert len(read_json(out)) == 20
