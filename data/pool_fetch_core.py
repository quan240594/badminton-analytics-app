#!/usr/bin/env python3
"""Shared per-pool scrape logic: discover a draw's matches, discover brand-new
player ids referenced in those matches (diffed against events_index.json),
and fetch just those new players' event pages via fetch_events.py.

Extracted from fetch_pool.py so both the single-pool on-demand CLI and the
national all-pools driver (scrape_all_pools.py) reuse the same discovery +
fetch flow instead of duplicating it. Deliberately does NOT touch
career.state.json, call build_career_db.py, or update fetched_pools.json -
each caller wants a different cadence for that (single-pool: immediately
after every fetch; national driver: once per whole run), so that lifecycle
stays owned by the caller.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from season import resolve_current_tournament_id

DATA_DIR = Path(__file__).resolve().parent
CURRENT_TOURNAMENT_ID = resolve_current_tournament_id("9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E")
BASE_URL = "https://badmintonnederland.toernooi.nl/sport/"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

MATCH_LINK_RE = re.compile(r"teammatch\.aspx\?id=([0-9A-Fa-f-]+)&match=(\d+)")
PLAYER_LINK_RE = re.compile(r"player\.aspx\?id=([0-9A-Fa-f-]+)&player=(\d+)")
TEAM_LINK_RE = re.compile(r"team\.aspx\?id=[0-9A-Fa-f-]+&team=(\d+)")
# teamplayers.aspx roster row: player id, then member id, then the "Vastspeler"
# ("fixed player") column - the closest thing that site's data model has to a
# "starter vs substitute" flag. Locale isn't consistently Dutch across requests
# (same cookie can get "Ja"/"Nee" or "Yes"/"No" back), so accept either.
TEAM_PLAYER_ROW_RE = re.compile(r'player\.aspx\?id=[0-9A-Fa-f-]+&player=(\d+)">[^<]*</a></td><td>\d+</td><td>(Ja|Nee|Yes|No)</td>')

ProgressCallback = Callable[[str, float, str], None]


def _noop_progress(step: str, percent: float, detail: str) -> None:
    return None


def fetch(url: str, cookie: str, extra_headers: dict | None = None) -> str:
    headers = {**BROWSER_HEADERS, "Cookie": cookie, **(extra_headers or {})}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_team_fixed_status(team_id: str, cookie: str) -> dict[str, dict]:
    """{local_player_id: {"fixed": bool, "gender": "M"|"F"}} for one team.

    The roster page renders two separate tables inside <td class="maleplayers">
    and <td class="femaleplayers"> - splitting on those markers is how gender
    is recovered, since the row itself carries no gender field."""
    html = fetch(
        f"{BASE_URL}teamplayers.aspx?id={CURRENT_TOURNAMENT_ID}&tid={team_id}",
        cookie,
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    male_idx = html.find('maleplayers')
    female_idx = html.find('femaleplayers')
    end_idx = html.find('addTeamPlayerTable')
    segments = []
    if male_idx != -1:
        segments.append((html[male_idx:female_idx if female_idx != -1 else end_idx], "M"))
    if female_idx != -1:
        segments.append((html[female_idx:end_idx if end_idx != -1 else len(html)], "F"))

    result: dict[str, dict] = {}
    for segment, gender in segments:
        for pid, flag in TEAM_PLAYER_ROW_RE.findall(segment):
            result[pid] = {"fixed": flag in ("Ja", "Yes"), "gender": gender}
    return result


def fetch_pool_players(
    draw_id: str,
    cookie: str,
    cookie_file: Path,
    delay: float = 1.2,
    progress_cb: Optional[ProgressCallback] = None,
) -> int:
    """Discovers draw_id's matches/players, fetches event pages for any player
    ids not already in events_index.json, and returns how many new players
    were found/fetched. Raises RuntimeError on discovery/fetch failure so
    callers can decide how to treat that pool (retry later, abort the run)."""
    progress = progress_cb or _noop_progress

    progress("matches", 2, "discovering matches")
    drawmatches_html = fetch(f"{BASE_URL}drawmatches.aspx?id={CURRENT_TOURNAMENT_ID}&draw={draw_id}", cookie)
    match_ids = sorted({m for _, m in MATCH_LINK_RE.findall(drawmatches_html)}, key=int)
    if not match_ids:
        raise RuntimeError("no matches found for this draw")

    player_ids: dict[str, None] = {}
    team_ids: set[str] = set()
    for i, match_id in enumerate(match_ids, 1):
        try:
            html = fetch(f"{BASE_URL}teammatch.aspx?id={CURRENT_TOURNAMENT_ID}&match={match_id}", cookie)
        except (urllib.error.HTTPError, urllib.error.URLError):
            continue
        for _, pid in PLAYER_LINK_RE.findall(html):
            player_ids[pid] = None
        team_ids.update(TEAM_LINK_RE.findall(html))
        progress("players", 5 + i / len(match_ids) * 35, f"{i}/{len(match_ids)} matches, {len(player_ids)} players found")
        time.sleep(delay)

    # Each team's roster page also exposes a real "Vastspeler" (fixed player)
    # flag per member - fetch it once per team (cached across runs/pools since
    # a team's roster rarely changes) instead of the old hardcoded name list.
    fetched_teams_path = DATA_DIR / "team_fixed_status_fetched.json"
    fetched_teams = set(json.loads(fetched_teams_path.read_text(encoding="utf-8"))) if fetched_teams_path.exists() else set()
    new_team_ids = sorted(team_ids - fetched_teams, key=int)
    # Roster members who haven't played a match yet this season never show up as
    # a "player" via the match-participant discovery above, so they'd otherwise
    # never get an event page (or career.json entry) at all - roster_ids closes
    # that gap by treating every registered team member as a fetch candidate too.
    roster_ids: set[str] = set()
    if new_team_ids:
        progress("roster", 39, f"fetching fixed-player status for {len(new_team_ids)} teams")
        fixed_status_path = DATA_DIR / "player_fixed_status.json"
        fixed_status = json.loads(fixed_status_path.read_text(encoding="utf-8")) if fixed_status_path.exists() else {}
        for tid in new_team_ids:
            try:
                team_status = fetch_team_fixed_status(tid, cookie)
            except (urllib.error.HTTPError, urllib.error.URLError):
                continue
            fixed_status.update(team_status)
            roster_ids.update(team_status.keys())
            fetched_teams.add(tid)
            time.sleep(delay)
        fixed_status_path.write_text(json.dumps(fixed_status, indent=2), encoding="utf-8")
        fetched_teams_path.write_text(json.dumps(sorted(fetched_teams, key=int)), encoding="utf-8")

    # Persist the FULL roster discovered for this pool - match participants plus
    # any roster-only members just found above - merged cumulatively (not
    # overwritten) so a member found once stays even on a later run where their
    # team is already cached and roster_ids comes back empty. Lets the client
    # scope its club/player pickers to whoever actually plays in this specific
    # pool instead of matching by club name alone (a club can field entirely
    # different players across divisions).
    rosters_path = DATA_DIR / "pool_rosters.json"
    rosters = {}
    if rosters_path.exists():
        rosters = json.loads(rosters_path.read_text(encoding="utf-8"))
    rosters[draw_id] = sorted(set(rosters.get(draw_id, [])) | set(player_ids) | roster_ids, key=int)
    rosters_path.write_text(json.dumps(rosters, indent=2), encoding="utf-8")

    events_path = DATA_DIR / "events_index.json"
    events = json.loads(events_path.read_text(encoding="utf-8"))
    known_ids = {e["player_id"] for e in events if e["tournament_id"] == CURRENT_TOURNAMENT_ID}
    new_ids = [pid for pid in (set(player_ids) | roster_ids) if pid not in known_ids]

    if not new_ids:
        progress("career", 90, "all players already cached")
        return 0

    new_entries = [
        {"tournament_id": CURRENT_TOURNAMENT_ID, "player_id": pid, "event_name": "Bondscompetitie 2026-2027"} for pid in new_ids
    ]
    filtered_index = DATA_DIR / f"events_index.pool_{draw_id}.json"
    filtered_index.write_text(json.dumps(new_entries), encoding="utf-8")

    events_dir = DATA_DIR / "pages" / "events"
    expected_paths = [events_dir / f"{CURRENT_TOURNAMENT_ID}_{pid}.html" for pid in new_ids]
    target = len(expected_paths)

    progress("career", 40, f"0/{target} new players")
    try:
        proc = subprocess.Popen(
            [sys.executable, "fetch_events.py", str(filtered_index), "--cookie-file", str(cookie_file), "--out", "pages/events"],
            cwd=DATA_DIR,
        )
        while proc.poll() is None:
            count = sum(1 for p in expected_paths if p.exists())
            progress("career", 40 + min(count, target) / target * 50, f"{min(count, target)}/{target} new players")
            time.sleep(1)
        returncode = proc.returncode
    finally:
        filtered_index.unlink(missing_ok=True)

    if returncode != 0:
        raise RuntimeError("fetch_events.py failed")

    events.extend(new_entries)
    events_path.write_text(json.dumps(events, indent=2, ensure_ascii=False), encoding="utf-8")

    return len(new_ids)
