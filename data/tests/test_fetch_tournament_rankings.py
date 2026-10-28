import json
from datetime import date

import fetch_tournament_rankings as ftr
from helpers_fetchers import header_map, install_urlopen, patch_io, run_main, url_error, write_cookie, write_json

ROWS = '<table><td class="right rankingpoints">12</td></table>'


def draw_with_members(*member_ids):
    players = [{"member_id": mid} if mid else {"name": "no id"} for mid in member_ids]
    return {"matches": [{"sides": [{"players": players}]}]}


def test_has_ranking_rows():
    assert ftr.has_ranking_rows(ROWS) is True
    assert ftr.has_ranking_rows("<td>nothing</td>") is False


def test_fetch_sends_cookie(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/x": "body"})
    assert ftr.fetch("http://h/x", "c=1") == "body"
    assert header_map(fake.requests[0])["cookie"] == "c=1"


def test_discover_member_ids_walks_all_draws(tmp_path):
    draws = write_json(
        tmp_path / "draws.json",
        {"T1": {"1": draw_with_members("5", None, "6"), "2": {}}, "T2": {"3": {"matches": [{}, {"sides": [{}]}]}, "4": draw_with_members("5", "7")}},
    )
    assert ftr.discover_member_ids(draws) == {"5", "6", "7"}


def test_discover_member_ids_missing_file(tmp_path):
    assert ftr.discover_member_ids(tmp_path / "missing.json") == set()


def test_fetch_member_ranking_falls_back_to_junior_list(monkeypatch, tmp_path, capsys):
    fake = install_urlopen(monkeypatch, {"rid=75": url_error("flaky"), "rid=164": ROWS})
    out = tmp_path / "player_9.html"
    assert ftr.fetch_member_ranking("9", out, "c", 1, 4) is True
    assert out.read_text(encoding="utf-8") == ROWS
    assert [u.split("?")[1] for u in fake.urls] == ["rid=75&player=9", "rid=164&player=9"]
    assert "[1/4] FAILED player=9 rid=75" in capsys.readouterr().out


def test_fetch_member_ranking_stops_at_first_list_with_rows(monkeypatch, tmp_path):
    fake = install_urlopen(monkeypatch, {"rid=75": ROWS})
    assert ftr.fetch_member_ranking("9", tmp_path / "p.html", "c", 1, 1) is True
    assert len(fake.requests) == 1


def test_fetch_member_ranking_without_rows_writes_nothing(monkeypatch, tmp_path):
    install_urlopen(monkeypatch, {"rid=": "<html/>"})
    out = tmp_path / "p.html"
    assert ftr.fetch_member_ranking("9", out, "c", 1, 1) is False
    assert not out.exists()


def test_main_fetches_only_pending_members(monkeypatch, tmp_path, capsys):
    ids = [str(100 + i) for i in range(26)]
    draws = write_json(tmp_path / "draws.json", {"T": {"1": draw_with_members(*ids, "1")}})
    out = tmp_path / "rankings"
    out.mkdir()
    (out / "player_1.html").write_text("cached", encoding="utf-8")
    fake, sleeps = patch_io(monkeypatch, ftr, {"player=101": "<html/>", "rid=": ROWS})
    run_main(monkeypatch, ftr, "--cookie-file", str(write_cookie(tmp_path)), "--draws-file", str(draws), "--out", str(out), "--lookups-file", str(tmp_path / "lookups.json"), "--delay", "0.1")
    printed = capsys.readouterr().out
    assert "27 known member ids, 26 not yet fetched" in printed
    assert "[25/26] progress: 24 fetched, 1 with no ranking yet" in printed
    assert "Done. Fetched 25, no-ranking-yet 1, total considered 26" in printed
    assert len(sleeps) == 26 and not (out / "player_101.html").exists() and (out / "player_100.html").exists()


def test_main_without_draws_file_has_nothing_to_do(monkeypatch, tmp_path, capsys):
    patch_io(monkeypatch, ftr)
    run_main(monkeypatch, ftr, "--cookie-file", str(write_cookie(tmp_path)), "--draws-file", str(tmp_path / "none.json"), "--out", str(tmp_path / "o"), "--lookups-file", str(tmp_path / "lookups.json"))
    assert "0 known member ids, 0 not yet fetched" in capsys.readouterr().out


def test_pending_skips_recent_lookups_and_rechecks_after_a_week(tmp_path):
    lookups = {"1": "2026-10-27", "2": "2026-10-20", "3": "2026-10-19"}
    assert ftr.pending_member_ids({"1", "2", "3", "4"}, tmp_path, lookups, date(2026, 10, 27)) == ["2", "3", "4"]
    (tmp_path / "player_4.html").write_text("x", encoding="utf-8")
    assert ftr.pending_member_ids({"4"}, tmp_path, {}, date(2026, 10, 27)) == []


def test_load_lookups_missing_file(tmp_path):
    assert ftr.load_lookups(tmp_path / "none.json") == {}


def test_main_records_every_lookup_and_caps_the_batch(monkeypatch, tmp_path, capsys):
    draws = write_json(tmp_path / "draws.json", {"T": {"1": draw_with_members("1", "2", "3")}})
    lookups_file = tmp_path / "lookups.json"
    patch_io(monkeypatch, ftr, {"player=2": "<html/>", "rid=": ROWS})
    args = ("--cookie-file", str(write_cookie(tmp_path)), "--draws-file", str(draws), "--out", str(tmp_path / "o"), "--lookups-file", str(lookups_file), "--delay", "0.1", "--limit", "2")
    run_main(monkeypatch, ftr, *args)
    first = json.loads(lookups_file.read_text(encoding="utf-8"))
    assert sorted(first) == ["1", "2"] and "Done. Fetched 1, no-ranking-yet 1, total considered 2" in capsys.readouterr().out
    run_main(monkeypatch, ftr, *args)
    assert "3 known member ids, 1 not yet fetched" in capsys.readouterr().out
    assert sorted(json.loads(lookups_file.read_text(encoding="utf-8"))) == ["1", "2", "3"]
