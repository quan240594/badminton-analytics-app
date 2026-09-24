#!/usr/bin/env python3
"""Time-boxed, resumable scrape of ALL national Bondscompetitie pools/divisions
(every draw in draw_teams.json), not just the single pool the League Day
Simulator's on-demand fetch focuses on. Meant to run daily via GitHub Actions:
each run resumes from wherever the previous run left off (checkpointed in
fetched_pools.json as each pool completes), stops once it hits its time
budget or too many consecutive failures (likely rate-limiting/blocking by the
source site), then does exactly ONE incremental career.json rebuild at the
end - build_career_db.py's own parsed_files state means only genuinely new
pages get parsed each day, not the whole cache, so runs stay cheap as more
pools accumulate.

Usage:
    python3 scrape_all_pools.py --minutes 110 [--cookie-file cookie.txt] [--delay 1.2]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
from pathlib import Path

from pool_fetch_core import fetch_pool_players

DATA_DIR = Path(__file__).resolve().parent
DRAW_TEAMS_PATH = DATA_DIR / "draw_teams.json"
FETCHED_POOLS_PATH = DATA_DIR / "fetched_pools.json"

CONSECUTIVE_FAILURE_LIMIT = 5


def load_fetched_pools() -> dict:
    if FETCHED_POOLS_PATH.exists():
        return json.loads(FETCHED_POOLS_PATH.read_text(encoding="utf-8"))
    return {}


def save_fetched_pools(fetched: dict) -> None:
    FETCHED_POOLS_PATH.write_text(json.dumps(fetched, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minutes", type=float, default=110, help="Wall-clock time budget for this run")
    parser.add_argument("--cookie-file", type=Path, default=DATA_DIR / "cookie.txt")
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    draw_teams = json.loads(DRAW_TEAMS_PATH.read_text(encoding="utf-8"))
    fetched = load_fetched_pools()
    total_pools = len(draw_teams)

    pending = sorted((d for d in draw_teams if d not in fetched), key=int)
    print(f"{len(fetched)}/{total_pools} pools already fetched; {len(pending)} pending this run", flush=True)

    start = time.monotonic()
    budget_seconds = args.minutes * 60
    completed = 0
    consecutive_failures = 0
    stop_reason = "all pending pools processed"

    for draw_id in pending:
        if time.monotonic() - start >= budget_seconds:
            stop_reason = "time budget reached"
            break

        label = draw_teams[draw_id].get("afdelingLabel", draw_id)
        print(f"Pool {draw_id} ({label})...", flush=True)
        try:
            new_count = fetch_pool_players(draw_id, cookie, args.cookie_file, args.delay)
        except (RuntimeError, urllib.error.URLError, TimeoutError) as ex:
            consecutive_failures += 1
            print(f"  FAILED: {ex} (consecutive failures: {consecutive_failures})", flush=True)
            if consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
                stop_reason = (
                    f"{CONSECUTIVE_FAILURE_LIMIT} consecutive failures - looks like the site may be "
                    "blocking/throttling rather than a one-off flaky request"
                )
                break
            continue

        fetched[draw_id] = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        save_fetched_pools(fetched)
        completed += 1
        consecutive_failures = 0
        print(f"  OK: {new_count} new player(s)", flush=True)

    elapsed_minutes = (time.monotonic() - start) / 60
    print("\nRebuilding career.json (incremental pass - only newly cached pages get parsed)...", flush=True)
    subprocess.run([sys.executable, "build_career_db.py", "pages", "--out", "career.json"], check=True, cwd=DATA_DIR)

    remaining = total_pools - len(fetched)
    print(
        f"\nRun summary: completed {completed} pool(s) this run, "
        f"{len(fetched)}/{total_pools} pools done overall ({remaining} remaining), "
        f"elapsed {elapsed_minutes:.1f} min, stopped because: {stop_reason}",
        flush=True,
    )


if __name__ == "__main__":
    main()
