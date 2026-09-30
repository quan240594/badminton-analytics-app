#!/usr/bin/env python3
"""Resumable scrape of draw standings/matches for tournaments already detail-
fetched (see scrape_all_tournaments.py). Prioritizes tournaments the user has
registered in or favorited (my_tournaments.json, from get_my_tournaments.py,
if present) - everything else falls back to plain tournament-id order.

Meant to run as one step in scrape-tournaments.yml's bounded loop: fetches
AT MOST ONE pending draw per invocation, same exit-code contract as
scrape_all_pools.py/scrape_all_tournaments.py (0 = did one, 3 = nothing
pending, other = real failure).

Usage:
    python3 scrape_all_draws.py --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from safe_path import safe_path

from fetch_tournament_draw import fetch_draw

DATA_DIR = Path(__file__).resolve().parent
DETAILS_PATH = DATA_DIR / "tournament_details.json"
MY_TOURNAMENTS_PATH = DATA_DIR / "my_tournaments.json"
FETCHED_DRAWS_PATH = DATA_DIR / "fetched_draws.json"
DRAWS_DATA_PATH = DATA_DIR / "tournament_draws_data.json"

NOTHING_TO_DO = 3


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    # hard-coded DATA_DIR-relative constant, not derived from any input
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR


def pending_work(details: dict, fetched: dict, my_tournament_ids: set[str]) -> list[tuple[str, str]]:
    """[(tournament_id, draw_id), ...], priority tournaments first, then by
    tournament id then draw id for stable, resumable ordering."""
    work = []
    for tid, detail in details.items():
        for draw in detail.get("draws", []):
            did = draw["draw_id"]
            if f"{tid}:{did}" not in fetched:
                work.append((tid, did))
    work.sort(key=lambda pair: (pair[0] not in my_tournament_ids, pair[0], int(pair[1])))
    return work


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)

    details = load_json(DETAILS_PATH, {})
    if not details:
        print("No tournament details fetched yet - nothing to do.", flush=True)
        sys.exit(NOTHING_TO_DO)

    my_tournament_ids = set(load_json(MY_TOURNAMENTS_PATH, []))
    fetched = load_json(FETCHED_DRAWS_PATH, {})
    work = pending_work(details, fetched, my_tournament_ids)

    if not work:
        print("All known draws already fetched - nothing left to do.", flush=True)
        sys.exit(NOTHING_TO_DO)

    tournament_id, draw_id = work[0]
    priority = " (priority: your tournament)" if tournament_id in my_tournament_ids else ""
    print(f"Draw {draw_id} of tournament {tournament_id}{priority}... [{len(work)} draws remaining]", flush=True)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    started = time.monotonic()
    try:
        draw = fetch_draw(tournament_id, draw_id, cookie)
    except (RuntimeError, OSError) as ex:
        print(f"  FAILED: {ex}", flush=True)
        sys.exit(1)
    elapsed = time.monotonic() - started

    all_draws = load_json(DRAWS_DATA_PATH, {})
    all_draws.setdefault(tournament_id, {})[draw_id] = draw
    save_json(DRAWS_DATA_PATH, all_draws)

    fetched[f"{tournament_id}:{draw_id}"] = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    save_json(FETCHED_DRAWS_PATH, fetched)

    print(f"  OK: {len(draw['standings'])} standings rows, {len(draw['matches'])} matches, took {elapsed / 60:.1f} min", flush=True)
    print(f"\nRun summary: {len(fetched)} draws done overall ({len(work) - 1} remaining).", flush=True)


if __name__ == "__main__":
    main()
