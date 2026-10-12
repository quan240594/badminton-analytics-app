#!/usr/bin/env python3
"""Keep the league match results current. scrape_all_pools.py fetches each pool
once and then reports "nothing left to do", and the weekly refresh_data.py job
re-fetches every player in a single run that GitHub kills after 6 hours before
it commits anything - so results played after the first fetch never arrived.

Each pass:
1. At most every --check-every-hours, fingerprints every pool's results page
   (match time + score - one cheap request per pool). A pool whose fingerprint
   changed (or is new and already has results) queues its roster players.
2. Re-reads queued players' pages, one request each, and replaces that player's
   current-season matches in career.state.json. Progress is saved as it goes,
   so a stopped run loses nothing and the next one resumes the queue.

Exit codes follow the other scrape drivers: 0 = more to do, 3 = nothing to do
(or today's budget is used up), anything else = real failure.

Usage:
    python3 refresh_league_results.py [--cookie-file cookie.txt] [--slice-minutes 10]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from functools import partial
from pathlib import Path

from build_career_db import (
    build_alias_reverse_index,
    load_event_source_map,
    load_state as load_career_state,
    record_player_file,
    resolve_guid_and_name,
    save_state as save_career_state,
)
from http_fetch import CHROME_HEADERS, RETRY_DELAYS, fetch_basic_retry, fetch_text
from parse_career import parse_player_file
from pool_fetch_core import BASE_URL, CURRENT_TOURNAMENT_ID
from safe_path import safe_path
from sanitize import clean_json_value
from scrape_all_pools import current_day_start

DATA_DIR = Path(__file__).resolve().parent
DRAW_TEAMS_PATH = DATA_DIR / "draw_teams.json"
POOL_ROSTERS_PATH = DATA_DIR / "pool_rosters.json"
STATE_PATH = DATA_DIR / "league_results_state.json"
CAREER_STATE_PATH = DATA_DIR / "career.state.json"
CAREER_PATH = DATA_DIR / "career.json"
PAGES_DIR = DATA_DIR / "pages"

NOTHING_TO_DO = 3
SAVE_EVERY = 25
MAX_CONSECUTIVE_FAILURES = 5
MAX_ATTEMPTS = 3
# The user's own pool (also refresh_data.py's change-check pool) goes first.
PRIORITY_DRAW_IDS = ("135",)

PLAYER_URL = "https://badmintonnederland.toernooi.nl/sport/league/player?id={tournament_id}&player={player_id}"
fetch_player_page = partial(fetch_text, headers=CHROME_HEADERS, retry_delays=RETRY_DELAYS)

ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.DOTALL)
MATCH_ID_RE = re.compile(r"teammatch\.aspx\?id=[0-9A-Fa-f-]+&(?:amp;)?match=(\d+)")
TIME_RE = re.compile(r'<td class="plannedtime"[^>]*>(.*?)</td>', re.DOTALL)
SCORE_RE = re.compile(r'<span class="score">\s*(?:<span>([^<]*)</span>)?')
TAG_RE = re.compile(r"<[^>]+>")


def parse_pool_results(html: str) -> dict[str, tuple[str, str]]:
    """{team match id: (planned time, score)} from a pool's drawmatches page; the
    score is empty until the match has been played."""
    results: dict[str, tuple[str, str]] = {}
    for row in ROW_RE.findall(html):
        match_id = MATCH_ID_RE.search(row)
        if not match_id:
            continue
        planned = TIME_RE.search(row)
        score = SCORE_RE.search(row)
        planned_text = " ".join(TAG_RE.sub(" ", planned.group(1)).split()) if planned else ""
        results[match_id.group(1)] = (planned_text, (score.group(1) or "").strip() if score else "")
    return results


def fingerprint(results: dict[str, tuple[str, str]]) -> str:
    lines = sorted(f"{match_id}|{planned}|{score}" for match_id, (planned, score) in results.items())
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    # hard-coded DATA_DIR constant, not derived from any input
    path.write_text(json.dumps(clean_json_value(data), indent=2, sort_keys=True), encoding="utf-8")  # NOSONAR


def new_state() -> dict:
    return {"pools": {}, "pending": [], "attempts": {}, "gaveUp": [], "lastPoolCheck": None, "budget": {"dayStart": None, "workSeconds": 0.0}}


def load_state(path: Path) -> dict:
    state = new_state()
    state.update(load_json(path, {}))
    return state


def roll_budget(state: dict, now: datetime, day_start_hour: int) -> dict:
    boundary = current_day_start(now, day_start_hour).isoformat()
    if state["budget"].get("dayStart") != boundary:
        state["budget"] = {"dayStart": boundary, "workSeconds": 0.0}
    return state["budget"]


def pool_check_due(state: dict, now: datetime, every_hours: float) -> bool:
    last = state.get("lastPoolCheck")
    return last is None or datetime.fromisoformat(last) <= now - timedelta(hours=every_hours)


def draw_order(draw_ids) -> list[str]:
    rest = sorted((d for d in draw_ids if d not in PRIORITY_DRAW_IDS), key=int)
    return [d for d in PRIORITY_DRAW_IDS if d in draw_ids] + rest


def queue_players(state: dict, player_ids) -> int:
    queued = set(state["pending"])
    added = [pid for pid in player_ids if pid not in queued]
    state["pending"].extend(added)
    return len(added)


def check_pools(state: dict, draw_ids, rosters: dict, cookie: str, delay: float, now: datetime) -> int:
    """Fingerprints each pool's results and queues the players of pools that
    changed; returns how many players were queued."""
    # Players whose page kept failing last time: their pool no longer looks
    # changed, so without this they would never be tried again.
    queued = queue_players(state, state["gaveUp"])
    state["gaveUp"] = []
    for draw_id in draw_order(draw_ids):
        try:
            html = fetch_basic_retry(f"{BASE_URL}drawmatches.aspx?id={CURRENT_TOURNAMENT_ID}&draw={draw_id}", cookie)
        except urllib.error.URLError as ex:
            print(f"  pool {draw_id}: FAILED {ex}", flush=True)
            continue
        results = parse_pool_results(html)
        if not results:
            continue  # an error/login page, not a results page - leave the pool as it was
        digest = fingerprint(results)
        played = sum(1 for _, score in results.values() if score)
        known = state["pools"].get(draw_id)
        changed = (known is None and played > 0) or (known is not None and known["fingerprint"] != digest)
        state["pools"][draw_id] = {"fingerprint": digest, "played": played, "checkedAt": now.isoformat(timespec="seconds")}
        if changed:
            queued += queue_players(state, rosters.get(draw_id, []))
        time.sleep(delay)
    state["lastPoolCheck"] = now.isoformat(timespec="seconds")
    return queued


def matches_of(career: dict, guid: str, tournament_id: str, player_id: str) -> list[dict]:
    return [
        m for m in career["players"].get(guid, {}).get("matches", [])
        if m["tournament_id"] == tournament_id and m["source_player_id"] == player_id
    ]


def refresh_player(career: dict, player_id: str, cookie: str, event_source_map: dict, pages_dir: Path) -> str:
    """Re-reads one player's page and replaces their current-season matches.
    Returns "updated", or "kept" when the page can't be trusted and the stored
    matches were left alone."""
    html = fetch_player_page(PLAYER_URL.format(tournament_id=CURRENT_TOURNAMENT_ID, player_id=player_id), cookie)
    pages_dir.mkdir(parents=True, exist_ok=True)
    # Kept on disk: fetch_rankings.py finds ranking links in these page files.
    page = pages_dir / f"player_{player_id}.html"
    page.write_text(html, encoding="utf-8")
    info = parse_player_file(page, CURRENT_TOURNAMENT_ID, player_id)
    if not info.profile_guid:
        return "kept"  # not a player page (login wall, error page)

    alias_to_guid = build_alias_reverse_index(career["players"])
    guid, name = resolve_guid_and_name(info, CURRENT_TOURNAMENT_ID, player_id, event_source_map, alias_to_guid)
    previous = matches_of(career, guid, CURRENT_TOURNAMENT_ID, player_id)
    if previous and not info.matches:
        return "kept"  # a player does not lose their matches - an expired session looks exactly like this

    if previous:
        career["players"][guid]["matches"] = [m for m in career["players"][guid]["matches"] if m not in previous]
    record_player_file(career, alias_to_guid, CURRENT_TOURNAMENT_ID, player_id, info, guid, name)
    career["parsed_files"] = sorted(set(career["parsed_files"]) | {page.name})
    return "updated"


def save_progress(state: dict, career: dict) -> None:
    save_json(STATE_PATH, state)
    save_career_state(CAREER_STATE_PATH, career)
    CAREER_PATH.write_text(json.dumps(clean_json_value(career["players"]), indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR


def record_failure(state: dict, player_id: str) -> None:
    """A transient failure: retry later, and after MAX_ATTEMPTS hand the player
    to the next pool check instead of losing them."""
    attempts = state["attempts"].get(player_id, 0) + 1
    if attempts < MAX_ATTEMPTS:
        state["attempts"][player_id] = attempts
        state["pending"].append(player_id)
    else:
        state["attempts"].pop(player_id, None)
        state["gaveUp"].append(player_id)
    print(f"  player {player_id}: FAILED ({attempts}/{MAX_ATTEMPTS})", flush=True)


def process_pending(state: dict, career: dict, cookie: str, delay: float, deadline: float) -> dict[str, int]:
    counts = {"updated": 0, "kept": 0, "failed": 0, "dropped": 0}
    event_source_map = load_event_source_map(PAGES_DIR)
    consecutive_failures = 0
    while state["pending"] and time.monotonic() < deadline and consecutive_failures < MAX_CONSECUTIVE_FAILURES:
        player_id = state["pending"].pop(0)
        try:
            status = refresh_player(career, player_id, cookie, event_source_map, PAGES_DIR)
        except urllib.error.HTTPError as ex:
            status = "dropped"  # the page is gone; retrying will not bring it back
            print(f"  player {player_id}: HTTP {ex.code}", flush=True)
        except urllib.error.URLError:
            status = "failed"
            record_failure(state, player_id)
        else:
            state["attempts"].pop(player_id, None)
        counts[status] += 1
        consecutive_failures = consecutive_failures + 1 if status == "failed" else 0
        if status == "updated" and counts["updated"] % SAVE_EVERY == 0:
            save_progress(state, career)
            print(f"  {counts['updated']} players refreshed, {len(state['pending'])} left", flush=True)
        time.sleep(delay)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=DATA_DIR / "cookie.txt")
    parser.add_argument("--delay", type=float, default=1.3)
    parser.add_argument("--slice-minutes", type=float, default=10, help="Max real time for this pass")
    parser.add_argument("--budget-minutes", type=float, default=150, help="Real scraping time allowed per day")
    parser.add_argument("--day-start-hour", type=int, default=8, help="UTC hour the daily budget resets at")
    parser.add_argument("--check-every-hours", type=float, default=6)
    parser.add_argument("--force", action="store_true", help="Ignore today's budget")
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)

    now = datetime.now(timezone.utc)
    state = load_state(STATE_PATH)
    budget = roll_budget(state, now, args.day_start_hour)
    remaining = args.budget_minutes * 60 - budget["workSeconds"]
    if remaining <= 0 and not args.force:
        print(f"Daily budget used up ({budget['workSeconds'] / 60:.1f}/{args.budget_minutes:.0f} min) - nothing to do this run.", flush=True)
        save_json(STATE_PATH, state)
        sys.exit(NOTHING_TO_DO)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    career = load_career_state(CAREER_STATE_PATH)
    started = time.monotonic()
    slice_seconds = args.slice_minutes * 60 if args.force else min(args.slice_minutes * 60, remaining)

    if pool_check_due(state, now, args.check_every_hours):
        draw_teams = load_json(DRAW_TEAMS_PATH, {})
        queued = check_pools(state, list(draw_teams), load_json(POOL_ROSTERS_PATH, {}), cookie, args.delay, now)
        print(f"Checked {len(draw_teams)} pools: {queued} players queued for a refresh", flush=True)
        save_json(STATE_PATH, state)

    counts = process_pending(state, career, cookie, args.delay, started + slice_seconds)
    budget["workSeconds"] += time.monotonic() - started
    save_progress(state, career)
    print(
        f"Refreshed {counts['updated']} players ({counts['kept']} kept as they were, {counts['failed']} failed, "
        f"{counts['dropped']} dropped); {len(state['pending'])} still queued.",
        flush=True,
    )
    if counts["failed"] and not counts["updated"] and not counts["kept"]:
        sys.exit(1)
    if not state["pending"]:
        sys.exit(NOTHING_TO_DO)


if __name__ == "__main__":
    main()
