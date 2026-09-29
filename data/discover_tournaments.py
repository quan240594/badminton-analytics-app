#!/usr/bin/env python3
"""Discover every NL badminton tournament listed on www.toernooi.nl within a
date window, via the same paginated search the "MEER LADEN" (load more) button
on the site uses - reverse-engineered from the real POST request, so this runs
as plain urllib against /find/tournament/DoSearch, no browser required per page
(just the one-time cookie from get_tournament_search_cookie.py).

Usage:
    python3 discover_tournaments.py --cookie-file tournament_cookie.txt \
        [--days-back 30] [--days-forward 365]
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from safe_path import safe_path

SEARCH_URL = "https://www.toernooi.nl/find/tournament/DoSearch"
BADMINTON_SPORT_ID = 2

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded",
}

# Split on the card wrapper, not the outer <li class="list__item"> - that class
# is reused by nested status-tag <li>s inside each card, which would otherwise
# fragment a single tournament's block right before its own tag markup.
ITEM_SPLIT_RE = re.compile(r'<div class="media">')
ID_RE = re.compile(r'tournament\?id=([0-9A-Fa-f-]+)')
NAME_RE = re.compile(r'title="([^"]+)"\s+class="media__link"')
CLUB_LOCATION_RE = re.compile(r'icon-marker.*?<span class="nav-link__value">\s*([^<]+?)\s*</span>', re.DOTALL)
TIME_RE = re.compile(r'<time datetime="([^"]+)">')
TAG_RE = re.compile(r'<span class="tag">\s*([^<]+?)\s*</span>')
TAG_DUO_RE = re.compile(
    r'<span class="tag-duo__title">\s*([^<]+?)\s*</span>\s*'
    r'<span class="tag-duo__value">\s*([^<]+?)\s*</span>'
)


def fetch_page(cookie: str, start_date: str, end_date: str, page: int) -> str:
    data = urllib.parse.urlencode(
        {
            "LoadMoreResults": "LoadMoreResults",
            "Page": str(page),
            "TournamentExtendedFilter.SportID": str(BADMINTON_SPORT_ID),
            "TournamentFilter.Q": "",
            "TournamentFilter.DateFilterType": "0",
            "TournamentFilter.StartDate": start_date,
            "TournamentFilter.EndDate": end_date,
            "TournamentFilter.PostalCode": "",
            "TournamentFilter.Distance": "15",
            "TournamentExtendedFilter.CountryCode": "NED",
            "TournamentExtendedFilter.StatusFilterID": "false",
        }
    ).encode()
    req = urllib.request.Request(SEARCH_URL, data=data, headers={**BROWSER_HEADERS, "Cookie": cookie}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_items(html: str) -> list[dict]:
    items = []
    for block in ITEM_SPLIT_RE.split(html)[1:]:
        id_match = ID_RE.search(block)
        name_match = NAME_RE.search(block)
        if not id_match or not name_match:
            continue
        club_location = CLUB_LOCATION_RE.search(block)
        club, _, location = (club_location.group(1).partition(" | ")) if club_location else ("", "", "")
        items.append(
            {
                "id": id_match.group(1).upper(),
                "name": name_match.group(1),
                "club": club.strip(),
                "location": location.strip(),
                "dates": TIME_RE.findall(block),
                "tags": TAG_RE.findall(block) + [f"{title}: {value}" for title, value in TAG_DUO_RE.findall(block)],
            }
        )
    return items


def discover(cookie: str, start_date: str, end_date: str, delay: float) -> dict[str, dict]:
    tournaments: dict[str, dict] = {}
    page = 1
    while True:
        html = fetch_page(cookie, start_date, end_date, page)
        items = parse_items(html)
        if not items:
            break
        for item in items:
            tournaments[item["id"]] = item
        print(f"page {page}: {len(items)} items, {len(tournaments)} total so far", flush=True)
        page += 1
        time.sleep(delay)
    return tournaments


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=Path("tournament_cookie.txt"))
    parser.add_argument("--out", type=Path, default=Path("tournaments.json"))
    parser.add_argument("--days-back", type=int, default=30, help="How many days before today to include (already-played tournaments)")
    parser.add_argument("--days-forward", type=int, default=365, help="How many days after today to include (upcoming/open tournaments)")
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)
    args.out = safe_path(args.out)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    today = date.today()
    start_date = (today - timedelta(days=args.days_back)).isoformat()
    end_date = (today + timedelta(days=args.days_forward)).isoformat()

    try:
        tournaments = discover(cookie, start_date, end_date, args.delay)
    except urllib.error.HTTPError as ex:
        raise SystemExit(f"Search request failed: HTTP {ex.code}") from ex

    args.out.write_text(json.dumps(tournaments, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone. {len(tournaments)} tournaments written to {args.out}")


if __name__ == "__main__":
    main()
