#!/usr/bin/env python3
"""On-demand fetch of one specific afdeling/pool's player rosters + match
history, for the region/division/pool browser. Discovers match ids via
drawmatches.aspx, player ids via teammatch.aspx per match, then reuses
fetch_events.py to scrape each newly-discovered player's league career page.

Writes live progress to pool_fetch_progress.json (same shape as
refresh_data.py's refresh_progress.json) so a caller can poll real percentages.

Usage:
    python3 fetch_pool.py --draw-id 12 [--cookie-file cookie.txt]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
from season import resolve_current_tournament_id

CURRENT_TOURNAMENT_ID = resolve_current_tournament_id("9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E")
BASE_URL = "https://badmintonnederland.toernooi.nl/sport/"
PROGRESS_PATH = DATA_DIR / "pool_fetch_progress.json"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

MATCH_LINK_RE = re.compile(r"teammatch\.aspx\?id=([0-9A-Fa-f-]+)&match=(\d+)")
PLAYER_LINK_RE = re.compile(r"player\.aspx\?id=([0-9A-Fa-f-]+)&player=(\d+)")


def write_progress(step: str, percent: float, detail: str = "", running: bool = True, error: str | None = None) -> None:
    PROGRESS_PATH.write_text(
        json.dumps({"step": step, "percent": round(max(0, min(percent, 100)), 1), "detail": detail, "running": running, "error": error}),
        encoding="utf-8",
    )


def fetch(url: str, cookie: str) -> str:
    req = urllib.request.Request(url, headers={**BROWSER_HEADERS, "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draw-id", required=True)
    parser.add_argument("--cookie-file", type=Path, default=DATA_DIR / "cookie.txt")
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()

    try:
        write_progress("matches", 2, "discovering matches")
        drawmatches_html = fetch(f"{BASE_URL}drawmatches.aspx?id={CURRENT_TOURNAMENT_ID}&draw={args.draw_id}", cookie)
        match_ids = sorted({m for _, m in MATCH_LINK_RE.findall(drawmatches_html)}, key=int)
        if not match_ids:
            raise RuntimeError("no matches found for this draw")

        player_ids: dict[str, None] = {}
        for i, match_id in enumerate(match_ids, 1):
            try:
                html = fetch(f"{BASE_URL}teammatch.aspx?id={CURRENT_TOURNAMENT_ID}&match={match_id}", cookie)
            except (urllib.error.HTTPError, urllib.error.URLError):
                continue
            for _, pid in PLAYER_LINK_RE.findall(html):
                player_ids[pid] = None
            write_progress("players", 5 + i / len(match_ids) * 35, f"{i}/{len(match_ids)} matches, {len(player_ids)} players found")
            time.sleep(args.delay)

        events = json.loads((DATA_DIR / "events_index.json").read_text(encoding="utf-8"))
        known_ids = {e["player_id"] for e in events if e["tournament_id"] == CURRENT_TOURNAMENT_ID}
        new_ids = [pid for pid in player_ids if pid not in known_ids]

        if new_ids:
            new_entries = [
                {"tournament_id": CURRENT_TOURNAMENT_ID, "player_id": pid, "event_name": "Bondscompetitie 2026-2027"} for pid in new_ids
            ]
            filtered_index = DATA_DIR / f"events_index.pool_{args.draw_id}.json"
            filtered_index.write_text(json.dumps(new_entries), encoding="utf-8")

            events_dir = DATA_DIR / "pages" / "events"
            expected_paths = [events_dir / f"{CURRENT_TOURNAMENT_ID}_{pid}.html" for pid in new_ids]
            target = len(expected_paths)

            write_progress("career", 40, f"0/{target} new players")
            proc = subprocess.Popen(
                [sys.executable, "fetch_events.py", str(filtered_index), "--cookie-file", str(args.cookie_file), "--out", "pages/events"],
                cwd=DATA_DIR,
            )
            while proc.poll() is None:
                count = sum(1 for p in expected_paths if p.exists())
                write_progress("career", 40 + min(count, target) / target * 50, f"{min(count, target)}/{target} new players")
                time.sleep(1)
            filtered_index.unlink(missing_ok=True)
            if proc.returncode != 0:
                raise RuntimeError("fetch_events.py failed")

            events.extend(new_entries)
            (DATA_DIR / "events_index.json").write_text(json.dumps(events, indent=2, ensure_ascii=False), encoding="utf-8")
        else:
            write_progress("career", 90, "all players already cached")

        write_progress("rebuild", 92, "rebuilding career.json")
        (DATA_DIR / "career.state.json").unlink(missing_ok=True)
        subprocess.run([sys.executable, "build_career_db.py", "pages", "--out", "career.json"], check=True, cwd=DATA_DIR)

        write_progress("done", 100, f"fetched {len(new_ids)} new players", running=False)
        print("pool fetch complete", flush=True)
    except Exception as ex:
        write_progress("error", 100, str(ex), running=False, error=str(ex))
        raise


if __name__ == "__main__":
    main()
