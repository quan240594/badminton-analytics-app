#!/usr/bin/env python3
"""Re-check "my" (registered/favorited) tournaments whose draw hasn't been
published yet, on a schedule derived from the tournament's own start date.

The site exposes no explicit "draw publication date", so this follows venue
practice instead: a weekend tournament's draw is reliably published by Friday
evening at the latest. Starting the Monday of tournament week, check once a
day (at 8am local) through Thursday; from Friday onward (and Saturday too for
a Sunday-start tournament) check every 2 hours starting at 8am local, since
that's when the draw is actually expected to land. All times are Europe/
Amsterdam local time (not UTC) since "8am"/"Friday evening" are venue-local
concepts and the Netherlands crosses a DST boundary mid-season.

Meant to run on its own short, hourly-ticking cron (see
watch-tournament-draws.yml) separate from the main bounded tournament-scrape
loop, since this only ever needs to recheck a small, personal set of
tournaments rather than the whole national inventory - the hourly tick itself
does nothing most hours, the schedule below decides whether "now" is actually
one of the allowed check moments for a given tournament.

Usage:
    python3 recheck_tournament_draws.py --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from safe_path import safe_path

from fetch_tournament_details import fetch_tournament_details

DATA_DIR = Path(__file__).resolve().parent
TOURNAMENTS_PATH = DATA_DIR / "tournaments.json"
DETAILS_PATH = DATA_DIR / "tournament_details.json"
MY_TOURNAMENTS_PATH = DATA_DIR / "my_tournaments.json"

DATE_FORMAT = "%Y-%m-%d %H:%M"
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
INTENSIVE_START_HOUR = 8
INTENSIVE_INTERVAL_HOURS = 2
# Past this many days beyond its own end date, a tournament that never got a
# draw published evidently isn't going to get one - stop rechecking it
# forever (e.g. a cancelled event with no online draw).
GIVE_UP_AFTER_DAYS = 30
# Sunday=6 in Python's Monday=0 weekday numbering.
SUNDAY = 6


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    # hard-coded DATA_DIR-relative constant, not derived from any input
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR


def parse_tournament_dates(dates: list[str]) -> tuple[date, date] | None:
    if not dates:
        return None
    try:
        start = datetime.strptime(dates[0], DATE_FORMAT).date()
        end = datetime.strptime(dates[-1], DATE_FORMAT).date()
        return start, end
    except ValueError:
        return None


def intensive_days_before_start(start_weekday: int) -> int:
    # A Saturday-start tournament's draw is expected by Friday evening (1 day
    # of every-2-hours checking); a Sunday-start one gets Friday AND Saturday
    # (2 days), since Saturday evening is the realistic equivalent "night
    # before" for a Sunday event. Any other start weekday (not an observed
    # case in practice - tournaments here are always weekend events) falls
    # back to just the single day immediately before.
    if start_weekday == SUNDAY:
        return 2
    return 1


def check_window(start: date, end: date, today: date, local_hour: int) -> bool:
    """Whether `today` at `local_hour` (Europe/Amsterdam) is a valid moment to
    recheck this tournament's draw, per the schedule described above."""
    monday_of_week = start - timedelta(days=start.weekday())
    if today < monday_of_week:
        return False  # too early - not even tournament week yet
    if today > end + timedelta(days=GIVE_UP_AFTER_DAYS):
        return False  # evidently never getting a draw - stop rechecking
    if local_hour < INTENSIVE_START_HOUR:
        return False  # before 8am local - never a check moment, either phase

    intensive_from = start - timedelta(days=intensive_days_before_start(start.weekday()))
    if today >= intensive_from:
        # Every 2 hours from 8am local onward.
        return (local_hour - INTENSIVE_START_HOUR) % INTENSIVE_INTERVAL_HOURS == 0
    # Daily phase (Monday through the day before the intensive window):
    # exactly one check, at 8am local.
    return local_hour == INTENSIVE_START_HOUR


def still_pending(tournament_id: str, tournaments: dict, details: dict, now_local: datetime) -> bool:
    tournament = tournaments.get(tournament_id)
    if not tournament:
        return False
    parsed_dates = parse_tournament_dates(tournament.get("dates", []))
    if not parsed_dates:
        return False
    start, end = parsed_dates
    if not check_window(start, end, now_local.date(), now_local.hour):
        return False
    existing_draws = details.get(tournament_id, {}).get("draws", [])
    return len(existing_draws) == 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)

    tournaments = load_json(TOURNAMENTS_PATH, {})
    details = load_json(DETAILS_PATH, {})
    my_tournament_ids = load_json(MY_TOURNAMENTS_PATH, [])
    now_local = datetime.now(LOCAL_TZ)

    pending = [tid for tid in my_tournament_ids if still_pending(tid, tournaments, details, now_local)]
    if not pending:
        print("No registered/favorited tournament is due for a draw recheck right now.", flush=True)
        return

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    found_any = False
    for tournament_id in pending:
        name = tournaments.get(tournament_id, {}).get("name", tournament_id)
        print(f"Rechecking {tournament_id} ({name})...", flush=True)
        new_details = fetch_tournament_details(tournament_id, cookie)
        details[tournament_id] = new_details
        if new_details["draws"]:
            found_any = True
            print(f"  Draw published! {len(new_details['draws'])} draws now available.", flush=True)
        else:
            print("  Still no draw published - will retry again later.", flush=True)

    save_json(DETAILS_PATH, details)
    print(f"\nRechecked {len(pending)} tournament(s), {'new draw(s) found' if found_any else 'no new draws yet'}.", flush=True)


if __name__ == "__main__":
    main()
