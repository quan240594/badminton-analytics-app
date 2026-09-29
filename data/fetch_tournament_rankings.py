#!/usr/bin/env python3
"""Fetch national ranking pages for tournament entrants, using the MemberIDs
discovered in tournament_draws_data.json's match data (a tournament-scoped
player.aspx page has no ranking-list link at all, unlike the league one - the
per-match head-to-head link is the only place that global id is exposed).

Reuses the existing rankings pipeline entirely unchanged: writes into the same
pages/rankings/player_{id}.html location parse_rankings.py already globs, so a
plain `python3 parse_rankings.py` run afterwards merges these into rankings.json
alongside the league players, no code changes needed there.

Since a tournament-scoped context doesn't tell us whether a player is on the
adult (rid=75) or junior (rid=164) list, this just tries both and keeps
whichever comes back with actual rows.

Usage:
    python3 fetch_tournament_rankings.py --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from safe_path import safe_path

BASE_URL = "https://badmintonnederland.toernooi.nl/ranking/"
RANKING_RIDS = ("75", "164")  # adult, then junior

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
}


def fetch(url: str, cookie: str) -> str:
    req = urllib.request.Request(url, headers={**BROWSER_HEADERS, "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def has_ranking_rows(html: str) -> bool:
    return '<td class="right rankingpoints">' in html


def discover_member_ids(draws_path: Path) -> set[str]:
    if not draws_path.exists():
        return set()
    all_draws = json.loads(draws_path.read_text(encoding="utf-8"))
    member_ids: set[str] = set()
    for draws_by_id in all_draws.values():
        for draw in draws_by_id.values():
            for match in draw.get("matches", []):
                for side in match.get("sides", []):
                    for player in side.get("players", []):
                        if player.get("member_id"):
                            member_ids.add(player["member_id"])
    return member_ids


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--draws-file", type=Path, default=Path("tournament_draws_data.json"))
    parser.add_argument("--out", type=Path, default=Path("pages/rankings"))
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)
    args.draws_file = safe_path(args.draws_file)
    args.out = safe_path(args.out)
    args.out.mkdir(parents=True, exist_ok=True)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    member_ids = discover_member_ids(args.draws_file)
    pending = sorted(mid for mid in member_ids if not (args.out / f"player_{mid}.html").exists())

    print(f"{len(member_ids)} known member ids, {len(pending)} not yet fetched", flush=True)
    fetched = failed = 0
    for i, member_id in enumerate(pending, 1):
        out_path = args.out / f"player_{member_id}.html"
        found = False
        for rid in RANKING_RIDS:
            try:
                html = fetch(f"{BASE_URL}player.aspx?rid={rid}&player={member_id}", cookie)
            except urllib.error.URLError as ex:
                print(f"[{i}/{len(pending)}] FAILED player={member_id} rid={rid} -> {ex}", flush=True)
                continue
            if has_ranking_rows(html):
                out_path.write_text(html, encoding="utf-8")
                found = True
                break
        if found:
            fetched += 1
        else:
            failed += 1  # no ranking on either list yet (e.g. a brand-new player) - not a real error
        if i % 25 == 0:
            print(f"[{i}/{len(pending)}] progress: {fetched} fetched, {failed} with no ranking yet", flush=True)
        time.sleep(args.delay)

    print(f"\nDone. Fetched {fetched}, no-ranking-yet {failed}, total considered {len(pending)}")


if __name__ == "__main__":
    main()
