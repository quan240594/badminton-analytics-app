"""Single source of truth for "what season is it right now", shared by every
scrape script that needs the current Bondscompetitie tournament id.

Historically that id (a random GUID minted by the source site each season -
see events_index.json, one distinct id per "Bondscompetitie YYYY-YYYY" event
name, confirmed not to follow any calendar-derivable pattern) had to be found
by hand every September and pasted into five different scripts. Since every
player's own profile page lists that mapping in its "Events with" history
(that's exactly what extract_events.py already scrapes into
events_index.json), we can instead look it up automatically once the
current-season label appears there - no manual GUID edit needed as long as
events_index.json has been refreshed at least once since the season rolled
over (via fetch_events.py + extract_events.py).
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
EVENTS_INDEX_PATH = DATA_DIR / "events_index.json"


def current_season_label(today: date | None = None) -> str:
    """Dutch club badminton seasons run roughly September-May, spanning two
    calendar years, so "current season" depends on today's date rather than
    being a value that's ever safe to hard-code."""
    today = today or date.today()
    year = today.year
    return f"{year}-{year + 1}" if today.month >= 9 else f"{year - 1}-{year}"


def resolve_current_tournament_id(default: str, season_label: str | None = None) -> str:
    """Looks up events_index.json for the tournament id already scraped for
    this season's "Bondscompetitie <label>" event. Falls back to `default`
    (with a loud warning) if events_index.json hasn't been refreshed since
    the season changed yet."""
    season_label = season_label or current_season_label()
    target_name = f"Bondscompetitie {season_label}"

    if not EVENTS_INDEX_PATH.exists():
        return default

    events = json.loads(EVENTS_INDEX_PATH.read_text(encoding="utf-8"))
    ids = {e["tournament_id"] for e in events if e.get("event_name") == target_name}

    if len(ids) == 1:
        return next(iter(ids))
    if len(ids) > 1:
        print(f"WARNING: multiple tournament ids found for '{target_name}' in events_index.json; using hard-coded default", file=sys.stderr)
        return default

    print(
        f"WARNING: no '{target_name}' entry in events_index.json yet - still using last season's hard-coded "
        f"tournament id ({default}). Re-run fetch_events.py + extract_events.py once this season's data exists "
        "on the source site to pick it up automatically.",
        file=sys.stderr,
    )
    return default
