"""Fetching and parsing of the public national ranking lists on badmintonnederland.toernooi.nl.

The lists (adult rid 75, junior rid 164) rank every player who has played ranked matches,
and each row carries the player's site-wide MemberID ("Lidnummer"), so the whole list can be
read without a login - a consent-only cookie is enough. That keeps the account's own session
out of this crawl, so a block here cannot lock the account out of the other scrapers.
"""

from __future__ import annotations

import html as html_lib
import re
import time
import urllib.error
import urllib.request

from http_fetch import CHROME_HEADERS

SITE_URL = "https://badmintonnederland.toernooi.nl"
# The adult list (the one league and tournaments use) and the junior list.
RANKING_LISTS = ("75", "164")
PAGE_SIZE = 25

# Answers that mean "slow down / go away", not "try again": retrying them right away is
# exactly what gets a client blocked for longer.
BLOCK_STATUSES = frozenset({403, 429, 503})
RETRY_DELAYS = (5, 15)


class BlockedError(Exception):
    """The site refused us (or served its cookie wall) - stop and back off."""


class FetchError(Exception):
    """A request kept failing for a reason that does not look like a block."""


LIST_WEEK_RE = re.compile(r'<option selected="selected" value="(\d+)">([^<]+)')
CATEGORY_LINK_RE = re.compile(r'<a href="category\.aspx\?id=\d+&(?:amp;)?category=(\d+)">([^<]+)</a>')
CAPTION_RE = re.compile(r"<caption>([^<]*)</caption>")
ROW_RE = re.compile(
    r'<td class="rank"><div[^>]*>(\d*)</div></td>(?:(?!</tr>).)*?'  # never reach into the next row
    r'<a href="player\.aspx\?id=\d+&(?:amp;)?player=(\d+)">([^<]+)</a></td>\s*'
    r"<td>(\d*)</td>\s*"
    r'<td class="right rankingpoints">(\d+)</td>\s*'
    r'<td class="right">(\d+)</td>',
    re.DOTALL,
)
PAGE_PARAM_RE = re.compile(r"category=\d+&(?:amp;)?p=(\d+)")
MORE_LABEL = "Meer"


def fetch_page(path: str, cookie: str, sleep=time.sleep) -> str:
    """GET one page of the ranking site. A block answer raises BlockedError at once;
    other failures are retried a couple of times with a growing pause."""
    request = urllib.request.Request(f"{SITE_URL}{path}", headers={**CHROME_HEADERS, "Cookie": cookie})
    for delay in (*RETRY_DELAYS, None):
        try:
            # Only the path varies; the host is the SITE_URL constant, so the request cannot go elsewhere.
            with urllib.request.urlopen(request, timeout=20) as response:  # NOSONAR
                return response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            if error.code in BLOCK_STATUSES:
                raise BlockedError(f"HTTP {error.code} for {path}") from error
            failure: Exception = error
        except (urllib.error.URLError, TimeoutError) as error:
            failure = error
        if delay is None:
            raise FetchError(f"{path}: {failure}") from failure
        sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


def parse_list_page(page: str) -> dict:
    """{weekId, week, categories: {category id: label}} of one ranking list's page."""
    week = LIST_WEEK_RE.search(page)
    categories: dict[str, str] = {}
    for category_id, label in CATEGORY_LINK_RE.findall(page):
        if label != MORE_LABEL:
            categories.setdefault(category_id, html_lib.unescape(label))
    if not week or not categories:
        raise BlockedError("ranking list page has no week/categories (cookie wall?)")
    return {"weekId": week.group(1), "week": week.group(2).strip(), "categories": categories}


def parse_category_page(page: str) -> dict:
    """{label, pages, rows} of one 25-row page of a category; a row without a MemberID is dropped."""
    if 'class="ruler"' not in page:
        raise BlockedError("ranking category page has no table (cookie wall?)")
    caption = CAPTION_RE.search(page)
    rows = [
        {
            "rank": int(rank) if rank else None,
            "playerId": player_id,
            "name": html_lib.unescape(name).strip(),
            "memberId": member_id,
            "points": int(points),
            "matches": int(matches),
        }
        for rank, player_id, name, member_id, points, matches in ROW_RE.findall(page)
        if member_id
    ]
    pages = max((int(p) for p in PAGE_PARAM_RE.findall(page)), default=1)
    return {"label": html_lib.unescape(caption.group(1)).strip() if caption else None, "pages": pages, "rows": rows}
