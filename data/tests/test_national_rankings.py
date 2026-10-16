import urllib.error

import pytest

import national_rankings as nr
from helpers_national import category_page, list_page, row_html

COOKIE = "sid=abc"


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body.encode("utf-8")


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "msg", {}, None)


def script_urlopen(monkeypatch, *outcomes):
    """Each call to urlopen yields the next outcome: an exception is raised, a string is the page body."""
    remaining = iter(outcomes)
    seen = []

    def fake_urlopen(request, timeout=None):
        seen.append(request)
        outcome = next(remaining)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(outcome)

    monkeypatch.setattr(nr.urllib.request, "urlopen", fake_urlopen)
    return seen


def test_parse_list_page_reads_week_and_categories_and_skips_more_links():
    parsed = nr.parse_list_page(list_page("54110", "40-2026", {"491": "Mannen Enkel", "495": "Gemengd Dubbel"}))
    assert parsed == {"weekId": "54110", "week": "40-2026", "categories": {"491": "Mannen Enkel", "495": "Gemengd Dubbel"}}


@pytest.mark.parametrize("page", ["<html>Wij vragen toestemming voor cookies</html>", list_page(categories={}), "<html></html>"])
def test_parse_list_page_treats_a_page_without_week_or_categories_as_a_block(page):
    with pytest.raises(nr.BlockedError):
        nr.parse_list_page(page)


def test_parse_category_page_reads_rows_label_and_page_count():
    page = category_page("Mannen Enkel", [(1, 1302758, "Noah Haase", 876236, 17492, 28), (2, 135573, "Dennis Koppen", 824274, 13802, 24)], pages=177)
    assert nr.parse_category_page(page) == {
        "label": "Mannen Enkel",
        "pages": 177,
        "rows": [
            {"rank": 1, "playerId": "1302758", "name": "Noah Haase", "memberId": "876236", "points": 17492, "matches": 28},
            {"rank": 2, "playerId": "135573", "name": "Dennis Koppen", "memberId": "824274", "points": 13802, "matches": 24},
        ],
    }


def test_parse_category_page_unescapes_names_and_keeps_tied_ranks_blank():
    page = category_page("Vrouwen Enkel", [("", 7, "Aisha O&#39;Neil &amp; Co", 55, 10, 2)])
    row = nr.parse_category_page(page)["rows"][0]
    assert row["name"] == "Aisha O'Neil & Co"
    assert row["rank"] is None


def test_parse_category_page_drops_rows_without_a_member_id_and_does_not_bleed_into_the_next_row():
    broken = '<tr> <td class="rank"><div style="">3</div></td><td>&nbsp;</td> </tr>'
    page = f'<table class="ruler"><caption>Mannen Enkel</caption>{broken}{row_html(4, 9, "Real Player", 4242, 50, 3)}{row_html(5, 10, "No Member", "", 40, 2)}</table>'
    rows = nr.parse_category_page(page)["rows"]
    assert [(r["rank"], r["name"]) for r in rows] == [(4, "Real Player")]


def test_parse_category_page_defaults_to_one_page_and_no_label():
    page = '<table class="ruler"></table>'
    assert nr.parse_category_page(page) == {"label": None, "pages": 1, "rows": []}


def test_parse_category_page_treats_a_page_without_the_table_as_a_block():
    with pytest.raises(nr.BlockedError):
        nr.parse_category_page("<html>cookiewall</html>")


def test_fetch_page_requests_the_site_path_with_the_cookie(monkeypatch):
    seen = script_urlopen(monkeypatch, "<html>ok</html>")
    assert nr.fetch_page("/ranking/", COOKIE) == "<html>ok</html>"
    assert seen[0].full_url == "https://badmintonnederland.toernooi.nl/ranking/"
    assert seen[0].get_header("Cookie") == COOKIE


@pytest.mark.parametrize("code", [403, 429, 503])
def test_fetch_page_stops_at_once_on_a_block_status(monkeypatch, code):
    seen, slept = script_urlopen(monkeypatch, http_error(code)), []
    with pytest.raises(nr.BlockedError, match=str(code)):
        nr.fetch_page("/ranking/", COOKIE, sleep=slept.append)
    assert len(seen) == 1
    assert slept == []


def test_fetch_page_retries_transient_failures_with_growing_pauses(monkeypatch):
    slept = []
    script_urlopen(monkeypatch, http_error(500), urllib.error.URLError("boom"), "<html>ok</html>")
    assert nr.fetch_page("/ranking/", COOKIE, sleep=slept.append) == "<html>ok</html>"
    assert slept == [5, 15]


def test_fetch_page_gives_up_after_the_last_retry(monkeypatch):
    slept = []
    script_urlopen(monkeypatch, TimeoutError("slow"), TimeoutError("slow"), TimeoutError("slow"))
    with pytest.raises(nr.FetchError, match="slow"):
        nr.fetch_page("/ranking/", COOKIE, sleep=slept.append)
    assert slept == [5, 15]
