#!/usr/bin/env python3
"""Fetch every historical event page listed in events_index.json.

Usage:
    python3 fetch_events.py events_index.json --cookie-file cookie.txt --out pages/events/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
from pathlib import Path

from http_fetch import fetch_chrome
from safe_path import safe_path

PLAYER_URL = "https://badmintonnederland.toernooi.nl/sport/league/player?id={tournament_id}&player={player_id}"


fetch = fetch_chrome


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("events_json", type=Path)
    parser.add_argument("--cookie-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("pages/events"))
    parser.add_argument("--delay", type=float, default=1.3)
    parser.add_argument("--limit", type=int, default=None, help="Only fetch the first N (for testing)")
    args = parser.parse_args()
    args.events_json = safe_path(args.events_json)
    args.cookie_file = safe_path(args.cookie_file)
    args.out = safe_path(args.out)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    args.out.mkdir(parents=True, exist_ok=True)

    events = json.loads(args.events_json.read_text(encoding="utf-8"))
    if args.limit:
        events = events[: args.limit]

    fetched = 0
    failed = 0
    skipped = 0
    total = len(events)
    for i, e in enumerate(events, 1):
        tid, pid = e["tournament_id"], e["player_id"]
        out_path = args.out / f"{tid}_{pid}.html"
        if out_path.exists():
            skipped += 1
            continue
        url = PLAYER_URL.format(tournament_id=tid, player_id=pid)
        try:
            html = fetch(url, cookie)
        except urllib.error.HTTPError as ex:
            print(f"[{i}/{total}] FAILED {url} -> HTTP {ex.code}", file=sys.stderr)
            failed += 1
            continue
        except urllib.error.URLError as ex:
            print(f"[{i}/{total}] FAILED {url} -> {ex.reason}", file=sys.stderr)
            failed += 1
            continue
        out_path.write_text(html, encoding="utf-8")
        fetched += 1
        if fetched % 25 == 0:
            print(f"[{i}/{total}] progress: {fetched} fetched, {failed} failed, {skipped} skipped")
        time.sleep(args.delay)

    print(f"\nDone. Fetched {fetched}, failed {failed}, skipped (already existed) {skipped}, total {total}")


if __name__ == "__main__":
    main()
