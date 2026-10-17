#!/usr/bin/env python3
"""Resumable, deliberately slow crawl of the national ranking lists - every ranked player in
the Netherlands, keyed by MemberID. Meant as one step of a bounded, self-chaining GitHub
Actions job (see scrape-national-players.yml); mirrors scrape_all_tournaments.py's contract:
exit 0 = more to do, exit 3 = nothing left for now (done, budget used up, or backing off).

Kept gentle on purpose so the site never has a reason to block us:
  * consent-only cookie, no login - the account's own session is never involved
  * one request at a time, 3-6 s apart, and a daily time budget (resets at --day-start-hour)
  * any 403/429/503 or cookie-wall page stops the run at once and sets a cooldown that grows
    (1h, 6h, then 24h) until a request succeeds again

State (national_players.json, committed like the other scrape state):
    lists:   rid -> {weekId, week, checkedAt, categories: cid -> {label, pages, next}}
    players: MemberID -> {name, playerId, ranks: rid -> {week, rankings: label -> {rank, points, matches}}}
    budget:  {dayStart, workSeconds}
    block:   {count, until}

Usage:
    python3 scrape_national_players.py [--cookie-file ranking_cookie.txt] [--slice-minutes 12]
        [--budget-minutes 45] [--day-start-hour 8] [--force]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from national_rankings import (
    PAGE_SIZE,
    RANKING_LISTS,
    BlockedError,
    fetch_page,
    parse_category_page,
    parse_list_page,
)
from safe_path import safe_path

DATA_DIR = Path(__file__).resolve().parent
STATE_PATH = DATA_DIR / "national_players.json"
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Same exit code the other scrape drivers use for "nothing left to do".
NOTHING_TO_DO = 3
# The lists only change a few times a year (a new week id), so a finished crawl only looks again daily.
LIST_CHECK_EVERY = timedelta(hours=24)
BLOCK_BACKOFF_HOURS = (1, 6, 24)
SAVE_EVERY = 10


def load_state(path: Path = STATE_PATH) -> dict:
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {"lists": {}, "players": {}, "budget": {}, "block": {"count": 0, "until": None}, **state}


def save_state(state: dict, path: Path = STATE_PATH) -> None:
    # Compact: ~10k players is too much to keep pretty-printed in git.
    path.write_text(json.dumps(state, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")  # NOSONAR


def stamp(moment: datetime) -> str:
    return moment.strftime(TIMESTAMP_FORMAT)


def parse_stamp(text: str | None) -> datetime | None:
    try:
        return datetime.strptime(text, TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def current_day_start(now: datetime, day_start_hour: int) -> datetime:
    boundary_today = now.replace(hour=day_start_hour, minute=0, second=0, microsecond=0)
    return boundary_today if now >= boundary_today else boundary_today - timedelta(days=1)


def load_daily_budget(state: dict, now: datetime, day_start_hour: int) -> dict:
    boundary = current_day_start(now, day_start_hour).isoformat()
    if state["budget"].get("dayStart") != boundary:
        state["budget"] = {"dayStart": boundary, "workSeconds": 0.0}
    return state["budget"]


def cooldown_until(state: dict) -> datetime | None:
    return parse_stamp(state["block"].get("until"))


def record_block(state: dict, now: datetime) -> datetime:
    count = state["block"].get("count", 0) + 1
    until = now + timedelta(hours=BLOCK_BACKOFF_HOURS[min(count, len(BLOCK_BACKOFF_HOURS)) - 1])
    state["block"] = {"count": count, "until": stamp(until)}
    return until


def categories_done(entry: dict) -> bool:
    return all(c["pages"] is not None and c["next"] > c["pages"] for c in entry["categories"].values())


def list_check_due(entry: dict | None, now: datetime) -> bool:
    if entry is None:
        return True
    checked = parse_stamp(entry.get("checkedAt"))
    return categories_done(entry) and (checked is None or now - checked >= LIST_CHECK_EVERY)


def refresh_list(state: dict, rid: str, cookie: str, now: datetime) -> None:
    """Read a list's current week and categories; a new week starts its crawl over."""
    parsed = parse_list_page(fetch_page(f"/ranking/ranking.aspx?rid={rid}", cookie))
    entry = state["lists"].get(rid)
    if entry is None or entry["weekId"] != parsed["weekId"]:
        entry = state["lists"][rid] = {
            "weekId": parsed["weekId"],
            "week": parsed["week"],
            "categories": {cid: {"label": label, "pages": None, "next": 1} for cid, label in parsed["categories"].items()},
        }
    entry["checkedAt"] = stamp(now)


def next_work(state: dict) -> tuple[str, str, int] | None:
    """(list id, category id, page) of the first page still to read, in list order."""
    for rid in RANKING_LISTS:
        for cid, category in state["lists"].get(rid, {}).get("categories", {}).items():
            if category["pages"] is None or category["next"] <= category["pages"]:
                return rid, cid, category["next"]
    return None


def record_rows(state: dict, rid: str, week: str, parsed: dict) -> None:
    for row in parsed["rows"]:
        player = state["players"].setdefault(row["memberId"], {"name": row["name"], "playerId": row["playerId"], "ranks": {}})
        player["name"], player["playerId"] = row["name"], row["playerId"]
        ranks = player["ranks"].get(rid)
        if ranks is None or ranks["week"] != week:
            ranks = player["ranks"][rid] = {"week": week, "rankings": {}}
        ranks["rankings"][parsed["label"]] = {"rank": row["rank"], "points": row["points"], "matches": row["matches"]}


def read_page(state: dict, rid: str, cid: str, page: int, cookie: str) -> None:
    entry = state["lists"][rid]
    path = f"/ranking/category.aspx?id={entry['weekId']}&category={cid}&p={page}&ps={PAGE_SIZE}"
    parsed = parse_category_page(fetch_page(path, cookie))
    category = entry["categories"][cid]
    category["pages"] = parsed["pages"]
    category["label"] = parsed["label"] or category["label"]
    category["next"] = page + 1
    record_rows(state, rid, entry["week"], {**parsed, "label": category["label"]})


def crawl(state: dict, cookie: str, *, slice_seconds: float, budget_seconds: float, now: datetime,
          pause=lambda: None, clock=time.monotonic, save=lambda: None) -> int:
    """Read pages until the slice or the day's budget runs out. Returns 0 (more to do) or NOTHING_TO_DO."""
    started = clock()
    budget = state["budget"]
    spent_before = budget.get("workSeconds", 0.0)
    pages_read = 0

    def out_of_time() -> bool:
        used = clock() - started
        return used >= slice_seconds or spent_before + used >= budget_seconds

    try:
        for rid in RANKING_LISTS:
            if list_check_due(state["lists"].get(rid), now):
                refresh_list(state, rid, cookie, now)
                pause()
        while not out_of_time():
            work = next_work(state)
            if work is None:
                return NOTHING_TO_DO
            read_page(state, *work, cookie)
            state["block"] = {"count": 0, "until": None}
            pages_read += 1
            if pages_read % SAVE_EVERY == 0:
                save()
            pause()
        return 0
    finally:
        budget["workSeconds"] = spent_before + (clock() - started)
        print(f"Read {pages_read} page(s); {len(state['players'])} players known.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cookie-file", type=Path, default=Path("ranking_cookie.txt"))
    parser.add_argument("--slice-minutes", type=float, default=12, help="Real time to spend in this run")
    parser.add_argument("--budget-minutes", type=float, default=45, help="Real scraping time allowed per day")
    parser.add_argument("--day-start-hour", type=int, default=8, help="UTC hour the daily budget resets at")
    parser.add_argument("--delay-min", type=float, default=3.0)
    parser.add_argument("--delay-max", type=float, default=6.0)
    parser.add_argument("--force", action="store_true", help="Ignore the daily budget and any cooldown")
    args = parser.parse_args()
    cookie_file = safe_path(args.cookie_file)

    now = datetime.now(timezone.utc)
    state = load_state()
    cooldown = cooldown_until(state)
    if cooldown and now < cooldown and not args.force:
        print(f"Backing off after a block until {cooldown.isoformat()} - nothing to do.", flush=True)
        sys.exit(NOTHING_TO_DO)
    budget = load_daily_budget(state, now, args.day_start_hour)
    if budget["workSeconds"] >= args.budget_minutes * 60 and not args.force:
        print(f"Daily budget used up ({budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min) - nothing to do.", flush=True)
        sys.exit(NOTHING_TO_DO)

    rng = random.SystemRandom()
    try:
        code = crawl(
            state, cookie_file.read_text(encoding="utf-8").strip(),
            slice_seconds=args.slice_minutes * 60, budget_seconds=float("inf") if args.force else args.budget_minutes * 60,
            now=now, pause=lambda: time.sleep(rng.uniform(args.delay_min, args.delay_max)),
            save=lambda: save_state(state),
        )
    except BlockedError as error:
        until = record_block(state, now)
        print(f"::warning::Ranking site pushed back ({error}); backing off until {until.isoformat()}.", flush=True)
        code = NOTHING_TO_DO
    finally:
        save_state(state)
    sys.exit(code)


if __name__ == "__main__":
    main()
