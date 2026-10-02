import pytest

import fetch_pages
from helpers_fetchers import (
    header_map,
    http_error,
    install_urlopen,
    no_sleep,
    patch_io,
    run_main,
    url_error,
    write_cookie,
    write_json,
)


@pytest.mark.parametrize(
    "href, expected",
    [
        ("/sport/team.aspx?id=X&team=1022", "team_1022"),
        ("/sport/teammatch.aspx?id=X&match=55", "match_55"),
        ("/sport/player.aspx?id=X&player=3", "player"),
        ("/sport/standings.aspx", "standings"),
        ("page.aspx?flag", "page"),
        ("", "page"),
    ],
)
def test_slugify(href, expected):
    assert fetch_pages.slugify(href) == expected


def test_load_links_merges_requested_categories_only(tmp_path):
    links = write_json(tmp_path / "links.json", {"team": [{"href": "a"}], "match": [{"href": "b"}], "other": [{"href": "c"}]})
    assert fetch_pages.load_links(links, ["team", "match", "missing"]) == [{"href": "a"}, {"href": "b"}]


def test_fetch_sends_browser_headers_cookie_and_referer(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/a": "héllo"})
    assert fetch_pages.fetch("http://x/a", "c=1", referer="http://ref") == "héllo"
    headers = header_map(fake.requests[0])
    assert headers["cookie"] == "c=1"
    assert headers["referer"] == "http://ref"
    assert headers["sec-fetch-dest"] == "document"


def test_fetch_omits_referer_by_default(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/a": "ok"})
    fetch_pages.fetch("http://x/a", "c=1")
    assert "referer" not in header_map(fake.requests[0])


def test_fetch_one_skips_existing_file(monkeypatch, tmp_path, capsys):
    install_urlopen(monkeypatch, {})
    target = tmp_path / "a.html"
    target.write_text("old", encoding="utf-8")
    assert fetch_pages.fetch_one("http://x/a", target, "c") is False
    assert "skip (exists): a.html" in capsys.readouterr().out
    assert target.read_text(encoding="utf-8") == "old"


@pytest.mark.parametrize(
    "error, message",
    [(http_error(503), "HTTP 503"), (url_error("dns down"), "dns down")],
)
def test_fetch_one_reports_failures(monkeypatch, tmp_path, capsys, error, message):
    install_urlopen(monkeypatch, {"/a": error})
    target = tmp_path / "a.html"
    assert fetch_pages.fetch_one("http://x/a", target, "c") is False
    assert message in capsys.readouterr().err
    assert not target.exists()


def test_fetch_one_saves_page(monkeypatch, tmp_path, capsys):
    install_urlopen(monkeypatch, {"/a": "<html/>"})
    target = tmp_path / "a.html"
    assert fetch_pages.fetch_one("http://x/a", target, "c", referer="r") is True
    assert target.read_text(encoding="utf-8") == "<html/>"
    assert "saved a.html (7 bytes)" in capsys.readouterr().out


def test_fetch_by_player_ids_skips_blank_and_existing(monkeypatch, tmp_path):
    fake = install_urlopen(monkeypatch, {"player=1": "p1", "player=3": "p3"})
    sleeps = no_sleep(monkeypatch)
    (tmp_path / "player_2.html").write_text("cached", encoding="utf-8")
    assert fetch_pages.fetch_by_player_ids("1, ,2,3", tmp_path, "c", 0.5) == 2
    assert [u.rsplit("=", 1)[-1] for u in fake.urls] == ["1", "3"]
    assert sleeps == [0.5, 0.5]


def test_fetch_by_links_deduplicates_hrefs(monkeypatch, tmp_path):
    fake = install_urlopen(monkeypatch, {"team=7": "t", "match=9": "m"})
    sleeps = no_sleep(monkeypatch)
    links = write_json(
        tmp_path / "links.json",
        {"team": [{"href": "/sport/team.aspx?id=X&team=7"}, {"href": "/sport/team.aspx?id=X&team=7"}], "match": [{"href": "teammatch.aspx?id=X&match=9"}]},
    )
    out = tmp_path / "out"
    out.mkdir()
    assert fetch_pages.fetch_by_links(links, "team, match,", out, "c", 0) == 2
    assert fake.urls[0].startswith("https://badmintonnederland.toernooi.nl/sport/team.aspx")
    assert fake.urls[1].startswith("https://badmintonnederland.toernooi.nl/sport/league/teammatch.aspx")
    assert sorted(p.name for p in out.iterdir()) == ["match_9.html", "team_7.html"]
    assert len(sleeps) == 2


def test_main_requires_cookie(monkeypatch, tmp_path):
    patch_io(monkeypatch, fetch_pages)
    with pytest.raises(SystemExit, match="Provide --cookie"):
        run_main(monkeypatch, fetch_pages, "--out", str(tmp_path / "o"))


def test_main_fetches_players_and_links_with_cookie_file(monkeypatch, tmp_path, capsys):
    fake, sleeps = patch_io(monkeypatch, fetch_pages, {"player=5": "p5", "team=7": "t7"})
    links = write_json(tmp_path / "links.json", {"team": [{"href": "/sport/team.aspx?id=X&team=7"}]})
    out = tmp_path / "pages"
    run_main(
        monkeypatch, fetch_pages, str(links), "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out),
        "--player-ids", "5", "--categories", "team", "--delay", "0.1",
    )
    assert sorted(p.name for p in out.iterdir()) == ["player_5.html", "team_7.html"]
    assert header_map(fake.requests[0])["cookie"] == "sess=abc"
    assert sleeps == [0.1, 0.1]
    assert "Done. Fetched 2 new pages" in capsys.readouterr().out


def test_main_accepts_inline_cookie_without_links(monkeypatch, tmp_path, capsys):
    fake, _ = patch_io(monkeypatch, fetch_pages, {"player=8": "p8"})
    run_main(monkeypatch, fetch_pages, "--cookie", "inline=1", "--out", str(tmp_path / "o"), "--player-ids", "8")
    assert header_map(fake.requests[0])["cookie"] == "inline=1"
    assert "Fetched 1 new pages" in capsys.readouterr().out


def test_main_with_no_inputs_fetches_nothing(monkeypatch, tmp_path, capsys):
    patch_io(monkeypatch, fetch_pages)
    run_main(monkeypatch, fetch_pages, "--cookie", "c", "--out", str(tmp_path / "o"))
    assert "Fetched 0 new pages" in capsys.readouterr().out

