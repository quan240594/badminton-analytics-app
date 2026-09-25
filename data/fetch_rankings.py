#!/usr/bin/env python3
"""Fetch each current-season player's Nationale Badminton Ranking page, plus the
top-of-list page for each ranking category (to compare against the #1 player).

Usage:
    python3 fetch_rankings.py --cookie-file cookie.txt --out pages/rankings/
"""

from __future__ import annotations

import argparse
import glob
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://badmintonnederland.toernooi.nl/ranking/"
RANKING_LIST_ID = "52448"
# A player's event page can link to more than one ranking list (e.g. the adult
# "Nationale Badminton Ranking" AND a junior list) - rid=75 is the adult list's
# consistent identifier sitewide; other rid values use a different category-id
# scheme our parser below doesn't recognize, so picking the wrong one silently
# yields zero parsed rows instead of an error.
MAIN_RANKING_RID = "75"
CATEGORIES = {"491": "singles", "493": "doubles", "495": "mixed"}
RANKING_LINK_RE = re.compile(r"ranking/player\.aspx\?rid=(\d+)&player=(\d+)")

BROWSER_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}


def fetch(url: str, cookie: str) -> str:
    req = urllib.request.Request(url, headers={**BROWSER_HEADERS, "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def discover_ranking_links(pages_dir: Path) -> dict[str, tuple[str, str]]:
    # Ranking links live on both the legacy root player_*.html pages and the
    # per-tournament pages/events/*.html pages fetched by the newer pool scraper.
    found: dict[str, tuple[str, str]] = {}
    paths = sorted(pages_dir.glob("player_*.html")) + sorted((pages_dir / "events").glob("*.html"))
    for path in paths:
        local_id = path.stem.split("_", 1)[1]
        text = path.read_text(encoding="utf-8", errors="replace")
        matches = RANKING_LINK_RE.findall(text)
        if not matches:
            continue
        # Prefer the adult main-list link if the player has more than one; fall
        # back to whichever was found so a player with only a specialty list
        # (e.g. junior-only) still gets something rather than nothing.
        main_match = next((m for m in matches if m[0] == MAIN_RANKING_RID), None)
        found[local_id] = main_match or matches[0]
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages-dir", type=Path, default=Path("pages"))
    parser.add_argument("--cookie-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("pages/rankings"))
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()

    links = discover_ranking_links(args.pages_dir)
    print(f"Found {len(links)} players with a ranking link")

    fetched = 0
    for local_id, (rid, ranking_player_id) in links.items():
        out_path = args.out / f"player_{local_id}.html"
        if out_path.exists():
            continue
        url = f"{BASE_URL}player.aspx?rid={rid}&player={ranking_player_id}"
        try:
            html = fetch(url, cookie)
        except (urllib.error.HTTPError, urllib.error.URLError) as ex:
            print(f"FAILED {local_id} -> {ex}")
            continue
        out_path.write_text(html, encoding="utf-8")
        fetched += 1
        print(f"saved player_{local_id}.html ({len(html)} bytes)")
        time.sleep(args.delay)

    for cat_id, label in CATEGORIES.items():
        out_path = args.out / f"category_{cat_id}.html"
        if out_path.exists():
            continue
        url = f"{BASE_URL}category.aspx?id={RANKING_LIST_ID}&category={cat_id}"
        try:
            html = fetch(url, cookie)
        except (urllib.error.HTTPError, urllib.error.URLError) as ex:
            print(f"FAILED category {label} -> {ex}")
            continue
        out_path.write_text(html, encoding="utf-8")
        fetched += 1
        print(f"saved category_{cat_id}.html ({label}, {len(html)} bytes)")
        time.sleep(args.delay)

    print(f"\nDone. Fetched {fetched} new pages into {args.out}/")


if __name__ == "__main__":
    main()
