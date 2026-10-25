#!/usr/bin/env python3
"""Sync the national ranking crawl (national_players.json) into Supabase Postgres.

Upserts through PostgREST with the service-role key (which bypasses RLS; the app itself only ever
reads, as a logged-in user). Players go first because rankings reference them. Rankings are keyed by
list, ranking week and category, so every weekly run adds a snapshot instead of overwriting history.
Nothing is ever deleted: someone who drops off the lists keeps their row and history.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Usage:
    python3 sync_supabase.py [--state national_players.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from safe_path import safe_path

DATA_DIR = Path(__file__).resolve().parent
STATE_PATH = DATA_DIR / "national_players.json"
BATCH_SIZE = 500
RETRY_DELAYS = (5, 15)
RANKINGS_CONFLICT = "member_id,list_id,week,category"


class SyncError(Exception):
    pass


def build_rows(state: dict, stamp: str) -> tuple[list[dict], list[dict]]:
    """(players rows, ranking rows) for everyone in the crawl state."""
    players, rankings = [], []
    for member_id, player in state.get("players", {}).items():
        players.append({"member_id": member_id, "name": player["name"], "site_player_id": player.get("playerId"), "updated_at": stamp})
        for list_id, entry in player.get("ranks", {}).items():
            for category, ranking in entry.get("rankings", {}).items():
                rankings.append({
                    "member_id": member_id, "list_id": list_id, "week": entry["week"], "category": category,
                    "rank": ranking["rank"], "points": ranking["points"], "matches": ranking["matches"],
                })
    return players, rankings


def chunks(rows: list[dict], size: int = BATCH_SIZE):
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def request(url: str, key: str, *, data: bytes | None = None, headers: dict | None = None, sleep=time.sleep):
    """One call to the project's REST API; 5xx and network errors are retried, anything else fails at once."""
    base_headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=base_headers, method="POST" if data is not None else "GET")
    for delay in (*RETRY_DELAYS, None):
        try:
            # The host was checked to be a *.supabase.co project URL before any request is built.
            with urllib.request.urlopen(req, timeout=60) as response:  # NOSONAR
                return response.headers, response.read()
        except urllib.error.HTTPError as error:
            if error.code < 500:
                raise SyncError(f"HTTP {error.code} from {urllib.parse.urlparse(url).path}: {error.read().decode('utf-8', 'replace')[:300]}") from error
            failure: Exception = error
        except (urllib.error.URLError, TimeoutError) as error:
            failure = error
        if delay is None:
            raise SyncError(f"{urllib.parse.urlparse(url).path}: {failure}") from failure
        sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


def upsert(base_url: str, key: str, table: str, conflict: str, rows: list[dict], sleep=time.sleep) -> None:
    for batch in chunks(rows):
        url = f"{base_url}/rest/v1/{table}?on_conflict={conflict}"
        request(url, key, data=json.dumps(batch).encode("utf-8"), headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, sleep=sleep)


def count_rows(base_url: str, key: str, table: str) -> int:
    headers, _ = request(f"{base_url}/rest/v1/{table}?select=member_id", key, headers={"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
    return int(headers["Content-Range"].rsplit("/", 1)[1])


def sync(state: dict, base_url: str, key: str, now: datetime | None = None, sleep=time.sleep) -> dict:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    players, rankings = build_rows(state, stamp)
    upsert(base_url, key, "players", "member_id", players, sleep)
    upsert(base_url, key, "national_rankings", RANKINGS_CONFLICT, rankings, sleep)
    in_db = count_rows(base_url, key, "players")
    if in_db < len(players):
        raise SyncError(f"only {in_db} players in the database after syncing {len(players)}")
    return {"players": len(players), "rankings": len(rankings), "players_in_db": in_db}


def project_url(value: str | None) -> str:
    parsed = urllib.parse.urlparse(value or "")
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".supabase.co"):
        raise SystemExit("SUPABASE_URL must be an https://<project>.supabase.co address")
    return f"https://{parsed.hostname}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--state", type=Path, default=STATE_PATH)
    args = parser.parse_args()
    state_path = safe_path(args.state)

    base_url = project_url(os.environ.get("SUPABASE_URL"))
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is not set")

    try:
        result = sync(json.loads(state_path.read_text(encoding="utf-8")), base_url, key)
    except SyncError as error:
        print(f"::error::Supabase sync failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"Synced {result['players']} players and {result['rankings']} ranking rows; {result['players_in_db']} players now in the database.")


if __name__ == "__main__":
    main()
