#!/usr/bin/env python3
"""Resolve tournament entrants to their site-wide MemberID and national ranking.

A tournament entry list carries only a tournament-local player id, and the
site-wide MemberID only surfaces once the player has played a scraped match -
so an entrant who is not a league player and has not played yet (seen live:
Ritvik Chawla, Helin Chow) had no ranking even though the site has a public
profile with one. Three public, login-free hops close that gap:

1. tournament player page   -> the "(MemberID)" shown next to the name
2. player search by MemberID -> the player's profile GUID
3. profile /ranking tab      -> rank + points per discipline, for the adult
                                list (rid 75) and the junior list (rid 164)

State lives in entrant_rankings.json (committed, like the other scrape state):
    entries:  "<tournament id>:<local player id>" -> MemberID
    rankings: MemberID -> {fetched_at, ranking: {singles/doubles/mixed: {rank, points}}}
so every entrant is resolved once, and a ranking is only refreshed (weekly) for
players in a tournament that has not ended yet.

Usage:
    python3 fetch_entrant_rankings.py [--cookie-file cookie.txt] [--limit 100]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from http_fetch import fetch_basic_retry
from recheck_tournament_draws import parse_tournament_dates
from safe_path import safe_path

DATA_DIR = Path(__file__).resolve().parent
TOURNAMENTS_PATH = DATA_DIR / "tournaments.json"
MY_TOURNAMENTS_PATH = DATA_DIR / "my_tournaments.json"
DETAILS_PATH = DATA_DIR / "tournament_details.json"
STATE_PATH = DATA_DIR / "entrant_rankings.json"

SITE_URL = "https://badmintonnederland.toernooi.nl"

# Same exit code the other scrape drivers use for "nothing left to do".
NOTHING_TO_DO = 3

# Rankings only change weekly (the lists are labelled by week number).
RANKING_MAX_AGE = timedelta(days=7)
SAVE_EVERY = 25

# One list per player, never a per-discipline mix: the adult and junior lists
# are on different point scales, so a junior doubles rank beside an adult
# singles rank would not be comparable. The adult list wins when the player is
# on it (it is the one these events use); a junior-only player gets the junior
# list, the same rule fetch_tournament_rankings.py already applies.
RANKING_LIST_PRIORITY = ("75", "164")

MEMBER_ID_RE = re.compile(r'<span class="media__title-aside">\((\d+)\)</span>')
PROFILE_GUID_RE = re.compile(r"/player-profile/([0-9A-Fa-f-]{36})")
SEARCH_ITEM_SPLIT = '<li class="list__item"'
RANKING_LIST_SPLIT_RE = re.compile(r'ranking\.aspx\?rid=(\d+)" class="flex-item flex-item--grow">')
RANKING_ROW_RE = re.compile(
    r'<th scope="row" class="th__title">\s*<a [^>]*>([^<]+)</a>\s*</th>\s*'
    r'<td class="text--right">\s*<a [^>]*>(\d+)</a>.*?</td>\s*'
    r"<td[^>]*>(\d+)</td>",
    re.DOTALL,
)


def discipline_of(category_label: str) -> str | None:
    # "Mannen Enkel" / "Vrouwen Enkel" / "Mannen Dubbel" / "Vrouwen Dubbel" /
    # "Gemengd Dubbel" - gender is irrelevant, mixed has to be tested first.
    if "Gemengd" in category_label:
        return "mixed"
    if "Enkel" in category_label:
        return "singles"
    if "Dubbel" in category_label:
        return "doubles"
    return None


def parse_player_page_member_id(html: str) -> str | None:
    match = MEMBER_ID_RE.search(html)
    return match.group(1) if match else None


def parse_search_profile_guid(html: str, member_id: str) -> str | None:
    """The profile GUID of the search result whose MemberID is exactly
    `member_id` - never a partial/name match, so a wrong person can't be picked."""
    for item in html.split(SEARCH_ITEM_SPLIT)[1:]:
        found = MEMBER_ID_RE.search(item)
        guid = PROFILE_GUID_RE.search(item)
        if found and guid and found.group(1) == member_id:
            return guid.group(1)
    return None


def parse_profile_ranking_lists(html: str) -> dict[str, dict]:
    """{ranking list id: {discipline: {rank, points}}} from a profile's ranking tab."""
    parts = RANKING_LIST_SPLIT_RE.split(html)
    lists: dict[str, dict] = {}
    for rid, section in zip(parts[1::2], parts[2::2], strict=True):
        disciplines: dict[str, dict] = {}
        for label, rank, points in RANKING_ROW_RE.findall(section):
            discipline = discipline_of(label)
            if discipline:
                disciplines[discipline] = {"rank": int(rank), "points": int(points)}
        if disciplines:
            lists[rid] = disciplines
    return lists


def pick_ranking_list(lists: dict[str, dict]) -> dict[str, dict]:
    for rid in RANKING_LIST_PRIORITY:
        if lists.get(rid):
            return lists[rid]
    return {}


def fetch_member_id(tournament_id: str, local_id: str, cookie: str) -> str | None:
    html = fetch_basic_retry(f"{SITE_URL}/tournament/{tournament_id.lower()}/player/{local_id}", cookie)
    return parse_player_page_member_id(html)


def fetch_ranking_for_member(member_id: str, cookie: str, delay: float) -> dict[str, dict]:
    search = fetch_basic_retry(
        f"{SITE_URL}/find/player/DoSearch?Page=1&SportID=2&Query={member_id}&X-Requested-With=XMLHttpRequest",
        cookie,
    )
    guid = parse_search_profile_guid(search, member_id)
    if not guid:
        return {}
    time.sleep(delay)
    profile = fetch_basic_retry(f"{SITE_URL}/player-profile/{guid}/ranking", cookie)
    return pick_ranking_list(parse_profile_ranking_lists(profile))


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"entries": {}, "rankings": {}}
    state = json.loads(path.read_text(encoding="utf-8"))
    state.setdefault("entries", {})
    state.setdefault("rankings", {})
    return state


def save_state(path: Path, state: dict) -> None:
    # path pre-validated by safe_path() against DATA_DIR (see safe_path.py)
    path.write_text(json.dumps(state, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")  # NOSONAR


def has_ended(dates: list[str], today: date) -> bool:
    parsed = parse_tournament_dates(dates)
    return parsed is not None and parsed[1] < today


def tournament_priority(item: tuple[str, list[str]], today: date, mine: frozenset[str] = frozenset()) -> tuple:
    # The user's own tournaments first (that is where the simulator is used),
    # then ones that have not ended (soonest first), then finished ones, most
    # recent first.
    tid, dates = item
    not_mine = tid not in mine
    parsed = parse_tournament_dates(dates)
    if parsed is None:
        return (not_mine, 2, 0)
    start, end = parsed
    if end >= today:
        return (not_mine, 0, start.toordinal())
    return (not_mine, 1, -start.toordinal())


def iter_entrants(
    details: dict, tournaments: dict, today: date, mine: frozenset[str] = frozenset()
) -> Iterator[tuple[str, str, bool]]:
    """(tournament id, local player id, tournament still active), in priority order."""
    dated = [(tid, (tournaments.get(tid) or {}).get("dates") or []) for tid in details]
    for tid, dates in sorted(dated, key=lambda item: tournament_priority(item, today, mine)):
        active = not has_ended(dates, today)
        for entry in details[tid].get("entries", []):
            yield tid, entry["player_id"], active


def needs_ranking(state: dict, member_id: str, active: bool, now: datetime) -> bool:
    record = state["rankings"].get(member_id)
    if record is None:
        return True
    fetched_at = datetime.fromisoformat(record["fetched_at"])
    return active and now - fetched_at >= RANKING_MAX_AGE


def process_entrant(state: dict, tid: str, local_id: str, active: bool, cookie: str, delay: float, now: datetime) -> bool:
    """Make whatever requests this entrant still needs; False if it needed none."""
    key = f"{tid}:{local_id}"
    member_id = state["entries"].get(key)
    worked = False
    if member_id is None:
        member_id = fetch_member_id(tid, local_id, cookie)
        worked = True
        if member_id is None:
            return worked  # no id on the page - retried on a later run
        state["entries"][key] = member_id
        time.sleep(delay)
    if needs_ranking(state, member_id, active, now):
        ranking = fetch_ranking_for_member(member_id, cookie, delay)
        state["rankings"][member_id] = {"fetched_at": now.isoformat(timespec="seconds"), "ranking": ranking}
        worked = True
        time.sleep(delay)
    return worked


def run(state: dict, entrants: Iterator[tuple[str, str, bool]], cookie: str, limit: int, delay: float, state_path: Path) -> int:
    now = datetime.now(timezone.utc)
    processed = 0
    for tid, local_id, active in entrants:
        if processed >= limit:
            break
        try:
            worked = process_entrant(state, tid, local_id, active, cookie, delay, now)
        except urllib.error.URLError as ex:
            # Transient (already retried by fetch_basic_retry) - leave the
            # entrant unresolved so the next run picks it up again.
            print(f"FAILED {tid}:{local_id} -> {ex}", flush=True)
            processed += 1
            continue
        if worked:
            processed += 1
            if processed % SAVE_EVERY == 0:
                save_state(state_path, state)
                print(f"[{processed}/{limit}] progress saved", flush=True)
    save_state(state_path, state)
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--limit", type=int, default=100, help="max entrants to work on per invocation")
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    details = json.loads(DETAILS_PATH.read_text(encoding="utf-8")) if DETAILS_PATH.exists() else {}
    tournaments = json.loads(TOURNAMENTS_PATH.read_text(encoding="utf-8")) if TOURNAMENTS_PATH.exists() else {}
    mine = frozenset(json.loads(MY_TOURNAMENTS_PATH.read_text(encoding="utf-8"))) if MY_TOURNAMENTS_PATH.exists() else frozenset()
    state = load_state(STATE_PATH)

    processed = run(state, iter_entrants(details, tournaments, date.today(), mine), cookie, args.limit, args.delay, STATE_PATH)
    resolved = sum(1 for r in state["rankings"].values() if r["ranking"])
    print(
        f"Done. {processed} entrants worked on, {len(state['entries'])} resolved to a MemberID, "
        f"{resolved}/{len(state['rankings'])} of those with a national ranking"
    )
    if processed == 0:
        sys.exit(NOTHING_TO_DO)


if __name__ == "__main__":
    main()
