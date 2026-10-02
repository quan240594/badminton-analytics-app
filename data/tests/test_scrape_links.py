import json
import sys
from pathlib import Path

import pytest

import scrape_links as sl

PAGE = """
<html><body>
<a href="teammatch.aspx?id=T&match=1">  Round   1
  vs <b>Foo</b></a>
<a href="team.aspx?id=T&team=2">Team Two</a>
<a href="team.aspx?id=T&team=2">Team Two</a>
<a href="style.CSS"></a>
<a name="anchor-without-href">ignored</a>
<a href="#top">Top</a>
<a href="https://example.org/page">Elsewhere</a>
text outside any anchor
<a href="unfinished.aspx">never closed
"""


@pytest.fixture(autouse=True)
def unrestricted_paths(monkeypatch):
    monkeypatch.setattr(sl, "safe_path", lambda p: Path(p))


@pytest.fixture
def html_file(tmp_path):
    path = tmp_path / "page.html"
    path.write_text(PAGE, encoding="utf-8")
    return path


def run_main(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["scrape_links.py", *map(str, argv)])
    sl.main()


def test_link_extractor_collects_normalized_text():
    extractor = sl.LinkExtractor()
    extractor.feed(PAGE)

    assert extractor.links[0] == ("teammatch.aspx?id=T&match=1", "Round 1 vs Foo")
    assert ("style.CSS", "") in extractor.links
    assert all(href != "unfinished.aspx" for href, _ in extractor.links)
    assert all(text != "ignored" for _, text in extractor.links)


@pytest.mark.parametrize(
    "href,category",
    [
        ("teammatch.aspx?x=1", "match"),
        ("team.aspx?x=1", "team"),
        ("location.aspx?x=1", "location"),
        ("playerstats.aspx", "player_stats"),
        ("drawstats.aspx", "draw_stats"),
        ("drawmatches.aspx", "draw_matches"),
        ("drawsheet.aspx", "draw_sheet"),
        ("draw.aspx", "draw_general"),
        ("/player-profile/abc", "player_profile"),
        ("teams.aspx", "teams_overview"),
        ("#top", "misc"),
        ("mailto:a@b.nl", "misc"),
        ("tel:123", "misc"),
        ("img/logo.PNG", "asset"),
        ("data.json", "asset"),
        ("https://example.org/page", "other"),
    ],
)
def test_categorize(href, category):
    assert sl.categorize(href) == category


def test_query_params_keeps_first_value_of_each_key():
    assert sl.query_params("x.aspx?id=A&team=2&team=3") == {"id": "A", "team": "2"}
    assert sl.query_params("x.aspx") == {}


def test_main_prints_every_category_sorted(monkeypatch, capsys, html_file):
    run_main(monkeypatch, html_file)

    out = capsys.readouterr().out
    headers = [line for line in out.splitlines() if line.startswith("=== ")]
    assert headers == ["=== asset (1) ===", "=== match (1) ===", "=== misc (1) ===", "=== other (1) ===", "=== team (2) ==="]
    assert "(no text)" in out
    assert "'Round 1 vs Foo'" in out


def test_main_unique_dedupes_hrefs(monkeypatch, capsys, html_file):
    run_main(monkeypatch, html_file, "--unique")

    assert "=== team (1) ===" in capsys.readouterr().out


@pytest.mark.parametrize("category,expected", [("team", "=== team (2) ==="), ("location", "")])
def test_main_category_filter(monkeypatch, capsys, html_file, category, expected):
    run_main(monkeypatch, html_file, "--category", category)

    out = capsys.readouterr().out
    assert out.strip().splitlines()[0:1] == ([expected] if expected else [])


def test_main_writes_json(monkeypatch, capsys, html_file, tmp_path):
    target = tmp_path / "links.json"

    run_main(monkeypatch, html_file, "--json", target, "--category", "match")

    data = json.loads(target.read_text(encoding="utf-8"))
    assert data["match"] == [{"href": "teammatch.aspx?id=T&match=1", "text": "Round 1 vs Foo", "params": {"id": "T", "match": "1"}}]
    assert f"Wrote 6 links to {target}" in capsys.readouterr().out
