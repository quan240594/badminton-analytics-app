#!/usr/bin/env python3
"""Resumable scrape of ALL national Bondscompetitie pools/divisions (every draw
in draw_teams.json), not just the single pool the League Day Simulator's
on-demand fetch focuses on. Meant to run every ~10 minutes via GitHub Actions
cron: each invocation fetches AT MOST ONE pending pool, then exits - the pause
between pools is simply the gap between cron ticks, so it costs no compute and
needs no in-process sleep. A persisted daily work budget (real fetch time only,
excluding the gaps between ticks) caps actual scraping to --budget-minutes per
day, where "day" resets at --day-start-hour UTC rather than midnight, so a
single slow pool spanning midnight doesn't get double-counted or reset early.

Usage:
    python3 scrape_all_pools.py [--cookie-file cookie.txt] [--delay 1.2]
                                 [--budget-minutes 120] [--day-start-hour 8] [--force]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pool_fetch_core import fetch_pool_players

DATA_DIR = Path(__file__).resolve().parent
DRAW_TEAMS_PATH = DATA_DIR / "draw_teams.json"
FETCHED_POOLS_PATH = DATA_DIR / "fetched_pools.json"
DAILY_BUDGET_PATH = DATA_DIR / "scrape_daily_budget.json"

# Distinct exit code so the workflow's calling loop can tell "budget/pools exhausted,
# stop looping" apart from a real failure (exit 1) or a completed fetch (exit 0).
NOTHING_TO_DO = 3


def load_fetched_pools() -> dict:
    if FETCHED_POOLS_PATH.exists():
        return json.loads(FETCHED_POOLS_PATH.read_text(encoding="utf-8"))
    return {}


def save_fetched_pools(fetched: dict) -> None:
    FETCHED_POOLS_PATH.write_text(json.dumps(fetched, indent=2), encoding="utf-8")


# The most recent day-start boundary at or before `now` - e.g. with
# day_start_hour=8, a run at 03:00 UTC belongs to the day that started
# yesterday at 08:00, not today.
def current_day_start(now: datetime, day_start_hour: int) -> datetime:
    boundary_today = now.replace(hour=day_start_hour, minute=0, second=0, microsecond=0)
    return boundary_today if now >= boundary_today else boundary_today - timedelta(days=1)


def load_daily_budget(now: datetime, day_start_hour: int) -> dict:
    boundary = current_day_start(now, day_start_hour)
    state = {}
    if DAILY_BUDGET_PATH.exists():
        state = json.loads(DAILY_BUDGET_PATH.read_text(encoding="utf-8"))
    if state.get("dayStart") != boundary.isoformat():
        state = {"dayStart": boundary.isoformat(), "workSeconds": 0.0}
    return state


def save_daily_budget(state: dict) -> None:
    DAILY_BUDGET_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=DATA_DIR / "cookie.txt")
    parser.add_argument("--delay", type=float, default=1.2)
    parser.add_argument("--budget-minutes", type=float, default=120, help="Real scraping time allowed per day")
    parser.add_argument("--day-start-hour", type=int, default=8, help="UTC hour the daily budget resets at")
    parser.add_argument("--force", action="store_true", help="Fetch a pool even if today's budget is used up")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    budget = load_daily_budget(now, args.day_start_hour)
    budget_seconds = args.budget_minutes * 60

    if budget["workSeconds"] >= budget_seconds and not args.force:
        next_reset = current_day_start(now, args.day_start_hour) + timedelta(days=1)
        print(
            f"Daily scrape budget used up ({budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min) - "
            f"next reset at {next_reset.isoformat()}. Nothing to do this run.",
            flush=True,
        )
        save_daily_budget(budget)  # persist a freshly-rolled-over boundary even when skipping
        sys.exit(NOTHING_TO_DO)

    draw_teams = json.loads(DRAW_TEAMS_PATH.read_text(encoding="utf-8"))
    fetched = load_fetched_pools()
    total_pools = len(draw_teams)
    pending = sorted((d for d in draw_teams if d not in fetched), key=int)

    if not pending:
        print(f"All {total_pools} pools already fetched - nothing left to do.", flush=True)
        sys.exit(NOTHING_TO_DO)

    draw_id = pending[0]
    label = draw_teams[draw_id].get("afdelingLabel", draw_id)
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    print(
        f"Pool {draw_id} ({label})... "
        f"[{len(fetched)}/{total_pools} done before this run, "
        f"{budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min of today's budget used]",
        flush=True,
    )

    started = time.monotonic()
    try:
        new_count = fetch_pool_players(draw_id, cookie, args.cookie_file, args.delay)
    except (RuntimeError, urllib.error.URLError, TimeoutError) as ex:
        budget["workSeconds"] += time.monotonic() - started
        save_daily_budget(budget)
        print(f"  FAILED: {ex}", flush=True)
        sys.exit(1)

    elapsed = time.monotonic() - started
    budget["workSeconds"] += elapsed
    save_daily_budget(budget)
    fetched[draw_id] = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    save_fetched_pools(fetched)
    print(f"  OK: {new_count} new player(s), took {elapsed / 60:.1f} min", flush=True)

    print("\nRebuilding career.json (incremental pass - only newly cached pages get parsed)...", flush=True)
    subprocess.run([sys.executable, "build_career_db.py", "pages", "--out", "career.json"], check=True, cwd=DATA_DIR)

    remaining = total_pools - len(fetched)
    print(
        f"\nRun summary: {len(fetched)}/{total_pools} pools done overall ({remaining} remaining), "
        f"today's budget now at {budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min.",
        flush=True,
    )


if __name__ == "__main__":
    main()
