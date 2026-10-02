import pytest

import fetch_rankings
from helpers_fetchers import header_map, install_urlopen, patch_io, run_main, url_error, write_cookie


def ranking_link(rid, player):
    return f'<a href="https://x/ranking/player.aspx?rid={rid}&player={player}">rank</a>'


@pytest.fixture
def pages(tmp_path):
    pages = tmp_path / "pages"
    (pages / "events").mkdir(parents=True)
    (pages / "player_1.html").write_text(ranking_link(164, 800) + ranking_link(75, 900), encoding="utf-8")
    (pages / "player_2.html").write_text(ranking_link(164, 801), encoding="utf-8")
    (pages / "player_3.html").write_text("no links here", encoding="utf-8")
    (pages / "events" / "T-1_4.html").write_text(ranking_link(75, 902), encoding="utf-8")
    return pages


def test_fetch_sends_cookie(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/r": "body"})
    assert fetch_rankings.fetch("http://x/r", "c=1") == "body"
    assert header_map(fake.requests[0])["cookie"] == "c=1"


def test_discover_ranking_links_prefers_main_list(pages):
    assert fetch_rankings.discover_ranking_links(pages) == {"1": ("75", "900"), "2": ("164", "801"), "4": ("75", "902")}


def test_discover_ranking_links_without_events_dir(tmp_path):
    assert fetch_rankings.discover_ranking_links(tmp_path) == {}


def test_main_fetches_players_and_categories_with_failures(monkeypatch, tmp_path, pages, capsys):
    out = tmp_path / "rank"
    out.mkdir()
    (out / "player_1.html").write_text("cached", encoding="utf-8")
    (out / "category_493.html").write_text("cached", encoding="utf-8")
    fake, sleeps = patch_io(
        monkeypatch,
        fetch_rankings,
        {"player=801": url_error("nope"), "player=902": "p4", "category=491": "c491", "category=495": url_error("down")},
    )
    run_main(monkeypatch, fetch_rankings, "--pages-dir", str(pages), "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out), "--delay", "0.3")
    captured = capsys.readouterr().out
    assert "Found 3 players with a ranking link" in captured
    assert "FAILED 2 ->" in captured
    assert "FAILED category mixed ->" in captured
    assert "saved player_4.html (2 bytes)" in captured
    assert "saved category_491.html (singles, 4 bytes)" in captured
    assert "Fetched 2 new pages" in captured
    assert (out / "player_4.html").read_text(encoding="utf-8") == "p4"
    assert not (out / "player_2.html").exists()
    assert sleeps == [0.3, 0.3]
    assert "rid=75&player=902" in fake.urls[1]
