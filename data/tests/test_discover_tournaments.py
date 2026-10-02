import urllib.parse
from datetime import date

import pytest

import discover_tournaments as dt
from helpers_fetchers import header_map, http_error, install_urlopen, no_sleep, patch_io, read_json, run_main, write_cookie


def card(tid="ab-12", name="Open", location="Club X | Utrecht", dates=("2025-10-04", "2025-10-05"), tags=(), duo=()):
    parts = ['<div class="media">']
    if tid:
        parts.append(f'<a href="/tournament?id={tid}" title="{name}" class="media__link">')
    if location is not None:
        parts.append(f'<i class="icon-marker"></i><span class="nav-link__value">{location}</span>')
    parts.extend(f'<time datetime="{d}">d</time>' for d in dates)
    parts.extend(f'<span class="tag">{t}</span>' for t in tags)
    parts.extend(f'<span class="tag-duo__title"> {t} </span><span class="tag-duo__value"> {v} </span>' for t, v in duo)
    return "".join(parts)


def form_of(req):
    return dict(urllib.parse.parse_qsl(req.data.decode()))


def test_fetch_page_posts_search_form(monkeypatch):
    fake = install_urlopen(monkeypatch, {"DoSearch": "html"})
    assert dt.fetch_page("c=1", "2025-01-01", "2025-12-31", 3) == "html"
    req = fake.requests[0]
    assert req.get_method() == "POST"
    form = form_of(req)
    assert form["Page"] == "3" and form["TournamentFilter.StartDate"] == "2025-01-01" and form["TournamentFilter.EndDate"] == "2025-12-31"
    assert form["TournamentExtendedFilter.SportID"] == str(dt.BADMINTON_SPORT_ID)
    headers = header_map(req)
    assert headers["cookie"] == "c=1" and headers["x-requested-with"] == "XMLHttpRequest"


def test_parse_items_extracts_card_fields():
    html = card(tags=("Open", " Junior "), duo=(("Level", "A"),)) + card("cd-34", "Cup", "Solo Club", ("2025-11-01",))
    assert dt.parse_items(html) == [
        {"id": "AB-12", "name": "Open", "club": "Club X", "location": "Utrecht", "dates": ["2025-10-04", "2025-10-05"], "tags": ["Open", "Junior", "Level: A"]},
        {"id": "CD-34", "name": "Cup", "club": "Solo Club", "location": "", "dates": ["2025-11-01"], "tags": []},
    ]


def test_parse_items_skips_incomplete_cards_and_defaults_club():
    html = card(tid="") + card("ef-56", "NoVenue", location=None) + '<div class="media"><a href="/tournament?id=aa">no title</a>'
    assert dt.parse_items(html) == [{"id": "EF-56", "name": "NoVenue", "club": "", "location": "", "dates": ["2025-10-04", "2025-10-05"], "tags": []}]


def test_parse_items_empty():
    assert dt.parse_items("<html/>") == []


def test_discover_pages_until_empty_and_dedupes(monkeypatch, capsys):
    sleeps = no_sleep(monkeypatch)
    fake = install_urlopen(monkeypatch, {"DoSearch": [card("a1", "A") + card("b2", "B"), card("b2", "B again") + card("c3", "C"), "<html/>"]})
    result = dt.discover("c", "s", "e", 0.7)
    assert list(result) == ["A1", "B2", "C3"] and result["B2"]["name"] == "B again"
    assert [form_of(r)["Page"] for r in fake.requests] == ["1", "2", "3"]
    assert sleeps == [0.7, 0.7]
    printed = capsys.readouterr().out
    assert "page 1: 2 items, 2 total so far" in printed and "page 2: 2 items, 3 total so far" in printed


@pytest.fixture
def frozen_today(monkeypatch):
    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 2)

    monkeypatch.setattr(dt, "date", FixedDate)


def test_main_writes_tournaments_for_date_window(monkeypatch, tmp_path, capsys, frozen_today):
    fake, _ = patch_io(monkeypatch, dt, {"DoSearch": [card("a1", "A"), "<html/>"]})
    out = tmp_path / "tournaments.json"
    run_main(monkeypatch, dt, "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out), "--days-back", "10", "--days-forward", "20")
    form = form_of(fake.requests[0])
    assert form["TournamentFilter.StartDate"] == "2026-09-22" and form["TournamentFilter.EndDate"] == "2026-10-22"
    assert list(read_json(out)) == ["A1"]
    assert "Done. 1 tournaments written to" in capsys.readouterr().out


def test_main_exits_on_http_error(monkeypatch, tmp_path, frozen_today):
    patch_io(monkeypatch, dt, {"DoSearch": http_error(403)})
    out = tmp_path / "tournaments.json"
    with pytest.raises(SystemExit, match="Search request failed: HTTP 403"):
        run_main(monkeypatch, dt, "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out))
    assert not out.exists()
