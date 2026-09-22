#!/usr/bin/env python3
"""Fetch team/match/player-stats/player pages using an authenticated cookie.

The site requires a full browser-like header set (Sec-Fetch-*, Accept,
Referer, sec-ch-ua) in addition to the session cookie - a bare Cookie header
gets redirected to the cookiewall for some page types (e.g. player pages).

Usage:
    python3 fetch_pages.py links.json --cookie-file cookie.txt --out pages/
    python3 fetch_pages.py links.json --cookie-file cookie.txt --out pages/ --categories team,match,player_stats
    python3 fetch_pages.py --player-ids 1548,5037,4185 --cookie-file cookie.txt --out pages/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

TOURNAMENT_ID = "9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E"
BASE_URL = "https://badmintonnederland.toernooi.nl/sport/league/"
PLAYER_URL = f"https://badmintonnederland.toernooi.nl/sport/league/player?id={TOURNAMENT_ID}&player={{player_id}}"
DEFAULT_CATEGORIES = ["team", "match", "player_stats"]
DELAY_SECONDS = 1.0  # be polite to the server

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


def load_links(links_path: Path, categories: list[str]) -> list[dict]:
    data = json.loads(links_path.read_text(encoding="utf-8"))
    items: list[dict] = []
    for category in categories:
        items.extend(data.get(category, []))
    return items


def slugify(href: str) -> str:
    # e.g. "/sport/team.aspx?id=...&team=1022" -> "team_1022"
    params = href.split("?", 1)[-1] if "?" in href else ""
    parts = dict(p.split("=", 1) for p in params.split("&") if "=" in p)
    if "team" in parts:
        return f"team_{parts['team']}"
    if "match" in parts:
        return f"match_{parts['match']}"
    name = href.rsplit("/", 1)[-1].split("?", 1)[0].replace(".aspx", "")
    return name or "page"


def fetch(url: str, cookie: str, referer: str | None = None) -> str:
    headers = dict(BROWSER_HEADERS)
    headers["Cookie"] = cookie
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_one(url: str, out_path: Path, cookie: str, referer: str | None = None) -> bool:
    if out_path.exists():
        print(f"skip (exists): {out_path.name}")
        return False
    try:
        html = fetch(url, cookie, referer=referer)
    except urllib.error.HTTPError as e:
        print(f"FAILED {url} -> HTTP {e.code}", file=sys.stderr)
        return False
    except urllib.error.URLError as e:
        print(f"FAILED {url} -> {e.reason}", file=sys.stderr)
        return False
    out_path.write_text(html, encoding="utf-8")
    print(f"saved {out_path.name} ({len(html)} bytes)")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("links_json", type=Path, nargs="?", help="Path to links.json produced by scrape_links.py")
    parser.add_argument("--cookie", help="Cookie header value")
    parser.add_argument("--cookie-file", type=Path, help="File containing the cookie header value")
    parser.add_argument("--out", type=Path, default=Path("pages"), help="Output directory")
    parser.add_argument("--categories", default=",".join(DEFAULT_CATEGORIES), help="Comma-separated categories to fetch")
    parser.add_argument("--delay", type=float, default=DELAY_SECONDS, help="Delay between requests in seconds")
    parser.add_argument("--player-ids", help="Comma-separated player IDs to fetch directly (bypasses links.json)")
    args = parser.parse_args()

    cookie = args.cookie or (args.cookie_file.read_text(encoding="utf-8").strip() if args.cookie_file else None)
    if not cookie:
        sys.exit("Provide --cookie or --cookie-file")

    args.out.mkdir(parents=True, exist_ok=True)
    fetched = 0

    if args.player_ids:
        for player_id in args.player_ids.split(","):
            player_id = player_id.strip()
            if not player_id:
                continue
            url = PLAYER_URL.format(player_id=player_id)
            out_path = args.out / f"player_{player_id}.html"
            if fetch_one(url, out_path, cookie):
                fetched += 1
                time.sleep(args.delay)

    if args.links_json:
        categories = [c.strip() for c in args.categories.split(",") if c.strip()]
        items = load_links(args.links_json, categories)
        seen_hrefs: set[str] = set()
        for item in items:
            href = item["href"]
            if href in seen_hrefs:
                continue
            seen_hrefs.add(href)
            url = urljoin(BASE_URL, href)
            out_path = args.out / f"{slugify(href)}.html"
            if fetch_one(url, out_path, cookie):
                fetched += 1
                time.sleep(args.delay)

    print(f"\nDone. Fetched {fetched} new pages into {args.out}/")


if __name__ == "__main__":
    main()
