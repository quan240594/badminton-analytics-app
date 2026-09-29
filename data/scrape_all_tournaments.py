#!/usr/bin/env python3
"""Resumable scrape of details (events/draws/entries) for every tournament in
tournaments.json. Meant to run as one step in a bounded, self-chaining GitHub
Actions job (see scrape-tournaments.yml) - each invocation refreshes the
tournament inventory (cheap - a handful of requests) then fetches details for
AT MOST ONE pending tournament, then exits, mirroring scrape_all_pools.py's
own daily-budget/exit-code contract exactly so the same workflow shape works
for both.

Usage:
    python3 scrape_all_tournaments.py [--cookie-file cookie.txt]
        [--tournament-cookie-file tournament_cookie.txt]
        [--budget-minutes 60] [--day-start-hour 8] [--force]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from safe_path import safe_path

from discover_tournaments import discover
from fetch_tournament_details import fetch_tournament_details

DATA_DIR = Path(__file__).resolve().parent
TOURNAMENTS_PATH = DATA_DIR / "tournaments.json"
FETCHED_TOURNAMENTS_PATH = DATA_DIR / "fetched_tournaments.json"
DAILY_BUDGET_PATH = DATA_DIR / "tournament_scrape_daily_budget.json"
DETAILS_PATH = DATA_DIR / "tournament_details.json"
MY_TOURNAMENTS_PATH = DATA_DIR / "my_tournaments.json"

# Distinct exit code so the calling workflow loop can tell "budget/tournaments
# exhausted, stop looping" apart from a real failure (exit 1).
NOTHING_TO_DO = 3


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def current_day_start(now: datetime, day_start_hour: int) -> datetime:
    boundary_today = now.replace(hour=day_start_hour, minute=0, second=0, microsecond=0)
    return boundary_today if now >= boundary_today else boundary_today - timedelta(days=1)


def load_daily_budget(now: datetime, day_start_hour: int) -> dict:
    boundary = current_day_start(now, day_start_hour)
    state = load_json(DAILY_BUDGET_PATH, {})
    if state.get("dayStart") != boundary.isoformat():
        state = {"dayStart": boundary.isoformat(), "workSeconds": 0.0}
    return state


def refresh_inventory(tournament_cookie_file: Path, days_back: int, days_forward: int, delay: float) -> dict:
    cookie = tournament_cookie_file.read_text(encoding="utf-8").strip()
    today = datetime.now(timezone.utc).date()
    start_date = (today - timedelta(days=days_back)).isoformat()
    end_date = (today + timedelta(days=days_forward)).isoformat()
    tournaments = discover(cookie, start_date, end_date, delay)
    save_json(TOURNAMENTS_PATH, tournaments)
    return tournaments


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--tournament-cookie-file", type=Path, default=Path("tournament_cookie.txt"))
    parser.add_argument("--days-back", type=int, default=30)
    parser.add_argument("--days-forward", type=int, default=365)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--budget-minutes", type=float, default=30, help="Real scraping time allowed per day")
    parser.add_argument("--day-start-hour", type=int, default=8, help="UTC hour the daily budget resets at")
    parser.add_argument("--force", action="store_true", help="Fetch a tournament even if today's budget is used up")
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)
    args.tournament_cookie_file = safe_path(args.tournament_cookie_file)

    now = datetime.now(timezone.utc)
    budget = load_daily_budget(now, args.day_start_hour)
    budget_seconds = args.budget_minutes * 60

    if budget["workSeconds"] >= budget_seconds and not args.force:
        next_reset = current_day_start(now, args.day_start_hour) + timedelta(days=1)
        print(
            f"Daily tournament-scrape budget used up ({budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min) - "
            f"next reset at {next_reset.isoformat()}. Nothing to do this run.",
            flush=True,
        )
        save_json(DAILY_BUDGET_PATH, budget)
        sys.exit(NOTHING_TO_DO)

    print("Refreshing tournament inventory...", flush=True)
    tournaments = refresh_inventory(args.tournament_cookie_file, args.days_back, args.days_forward, args.delay)

    fetched = load_json(FETCHED_TOURNAMENTS_PATH, {})
    total = len(tournaments)
    # Same priority rule as scrape_all_draws.py: registered/favorited
    # tournaments first, since a national tournament list can be large enough
    # (600+) that plain id order might not reach the ones the user actually
    # cares about for a long time within the daily budget.
    my_tournament_ids = set(load_json(MY_TOURNAMENTS_PATH, []))
    pending = sorted(
        (tid for tid in tournaments if tid not in fetched),
        key=lambda tid: (tid not in my_tournament_ids, tid),
    )

    if not pending:
        print(f"All {total} known tournaments already fetched - nothing left to do.", flush=True)
        sys.exit(NOTHING_TO_DO)

    tournament_id = pending[0]
    name = tournaments[tournament_id].get("name", tournament_id)
    priority = " (priority: your tournament)" if tournament_id in my_tournament_ids else ""
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    print(
        f"Tournament {tournament_id} ({name}){priority}... "
        f"[{len(fetched)}/{total} done before this run, "
        f"{budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min of today's budget used]",
        flush=True,
    )

    started = time.monotonic()
    try:
        details = fetch_tournament_details(tournament_id, cookie)
    except (RuntimeError, OSError) as ex:
        budget["workSeconds"] += time.monotonic() - started
        save_json(DAILY_BUDGET_PATH, budget)
        print(f"  FAILED: {ex}", flush=True)
        sys.exit(1)

    elapsed = time.monotonic() - started
    budget["workSeconds"] += elapsed
    save_json(DAILY_BUDGET_PATH, budget)

    all_details = load_json(DETAILS_PATH, {})
    all_details[tournament_id] = details
    save_json(DETAILS_PATH, all_details)

    fetched[tournament_id] = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    save_json(FETCHED_TOURNAMENTS_PATH, fetched)

    print(
        f"  OK: {len(details['events'])} events, {len(details['draws'])} draws, "
        f"{len(details['entries'])} entries, took {elapsed / 60:.1f} min",
        flush=True,
    )

    remaining = total - len(fetched)
    print(
        f"\nRun summary: {len(fetched)}/{total} tournaments done overall ({remaining} remaining), "
        f"today's budget now at {budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min.",
        flush=True,
    )


if __name__ == "__main__":
    main()
