import json
import sys

import pytest

import extract_events as ee


def event_link(tid, pid, name):
    return f'<a href="../player.aspx?id={tid}&player={pid}">{name}</a>'


def player_page(name="Jan", events=(), outside=""):
    rows = "".join(f'<tr><th colspan="2">2024</th></tr><tr><td>{e}</td><td class="dates">x</td></tr>' for e in events or ())
    section = f"<div><div>Events with {name}<table>{rows}</table></div></div>" if events is not None else ""
    header = f'<h2>{name}<a href="/player-profile/G1">p</a></h2>' if name else ""
    return f"<html>{header}{outside}{section}</html>"


def write(path, html):
    path.write_text(html, encoding="utf-8")
    return path


def test_parse_player_file_collects_event_links(tmp_path):
    html = player_page(
        "Jan &amp; Co",
        events=[event_link("AB-12", "5", "Bondscompetitie &amp; Cup"), event_link("CD-34", "6", "  Open  ")],
        outside=event_link("EE-99", "1", "Outside"),
    )

    events = ee.parse_player_file(write(tmp_path / "player_1.html", html))

    assert [(e["tournament_id"], e["player_id"], e["event_name"]) for e in events] == [
        ("AB-12", "5", "Bondscompetitie & Cup"),
        ("CD-34", "6", "Open"),
    ]
    assert {(e["source_player_file"], e["source_player_name"]) for e in events} == {("player_1", "Jan & Co")}


@pytest.mark.parametrize("html", [player_page(events=None, outside=event_link("A", "1", "x")), "<html></html>"])
def test_parse_player_file_without_events_section_is_empty(tmp_path, html):
    assert ee.parse_player_file(write(tmp_path / "player_2.html", html)) == []


def test_parse_player_file_falls_back_to_file_stem_for_name(tmp_path):
    html = player_page(name="", events=[event_link("A", "1", "Cup")])

    (event,) = ee.parse_player_file(write(tmp_path / "player_3.html", html))

    assert event["source_player_name"] == "player_3"


def test_main_dedupes_by_tournament_and_player(tmp_path, monkeypatch, capsys):
    shared = event_link("AB-12", "5", "Shared Cup")
    write(tmp_path / "player_1.html", player_page("Jan", [shared, event_link("CD-34", "6", "Solo")]))
    write(tmp_path / "player_2.html", player_page("Piet", [shared]))
    write(tmp_path / "other.html", player_page("Ignored", [event_link("ZZ", "9", "Never")]))
    target = tmp_path / "events.json"
    monkeypatch.setattr(sys, "argv", ["extract_events.py", str(tmp_path), "--json", str(target)])

    ee.main()

    unique = json.loads(target.read_text(encoding="utf-8"))
    assert [(e["tournament_id"], e["player_id"], e["source_player_file"]) for e in unique] == [
        ("AB-12", "5", "player_1"),
        ("CD-34", "6", "player_1"),
    ]
    out = capsys.readouterr().out
    assert "Found 3 event references, 2 unique" in out
    assert f"Wrote {target}" in out
