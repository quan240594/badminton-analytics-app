#!/usr/bin/env python3
"""Fetch drawmatches.aspx for every draw listed in draws.aspx (the national
Bondscompetitie index) and record which team names play in each draw.

Output: draw_teams.json ({drawId: {division, afdelingLabel, teams: [name...]}})

Usage:
    python3 fetch_draw_teams.py --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from season import resolve_current_tournament_id

CURRENT_TOURNAMENT_ID = resolve_current_tournament_id("9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E")
BASE_URL = "https://badmintonnederland.toernooi.nl/sport/"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DRAW_LINK_RE = re.compile(r'<a href="draw\.aspx\?id=([0-9A-Fa-f-]+)&draw=(\d+)"[^>]*>([^<]+)</a>')
TEAM_LINK_RE = re.compile(r'<a[^>]*href="teammatch\.aspx\?[^"]+"[^>]*>([^<]*)</a>')


def fetch(url: str, cookie: str) -> str:
    req = urllib.request.Request(url, headers={**BROWSER_HEADERS, "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--out", type=Path, default=Path("draw_teams.json"))
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()

    draws_html = fetch(f"{BASE_URL}draws.aspx?id={CURRENT_TOURNAMENT_ID}", cookie)
    draws = DRAW_LINK_RE.findall(draws_html)
    print(f"found {len(draws)} draws")

    existing: dict[str, dict] = {}
    if args.out.exists():
        existing = json.loads(args.out.read_text(encoding="utf-8"))

    for i, (tid, draw_id, label) in enumerate(draws, 1):
        if draw_id in existing:
            continue
        parts = label.split("–")
        division = parts[1].strip() if len(parts) > 1 else label.strip()
        afdeling_label = parts[2].strip() if len(parts) > 2 else label.strip()
        url = f"{BASE_URL}drawmatches.aspx?id={tid}&draw={draw_id}"
        try:
            html = fetch(url, cookie)
        except (urllib.error.HTTPError, urllib.error.URLError) as ex:
            print(f"[{i}/{len(draws)}] FAILED draw={draw_id} -> {ex}")
            continue
        team_names = sorted({re.sub(r"\s+\d+$", "", t.strip()) for t in TEAM_LINK_RE.findall(html) if t.strip() and t.strip() != "Modify"})
        existing[draw_id] = {"division": division, "afdelingLabel": afdeling_label, "teams": team_names}
        if i % 10 == 0:
            print(f"[{i}/{len(draws)}] draw={draw_id} {afdeling_label} -> {len(team_names)} teams")
            args.out.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
        time.sleep(args.delay)

    args.out.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"done. wrote {len(existing)} draws to {args.out}")


if __name__ == "__main__":
    main()
