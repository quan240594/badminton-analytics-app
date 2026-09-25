#!/usr/bin/env python3
"""Bounded data refresh: re-fetches only current-season match pages plus all
national ranking pages (not the full multi-season historical backfill), then
rebuilds career.json and rankings.json from the refreshed local pages.

Writes live progress to refresh_progress.json as it runs, so a caller (e.g. the
Node server) can poll real completion percentages instead of just waiting for
the process to exit.

Usage:
    python3 refresh_data.py [--cookie-file cookie.txt] [--browser chrome]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_rankings import discover_ranking_links  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent
from season import resolve_current_tournament_id  # noqa: E402

CURRENT_TOURNAMENT_ID = resolve_current_tournament_id("9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E")
# The current pool's drawmatches page is a cheap proxy for "did anything about our results change".
CHANGE_CHECK_DRAW_ID = "135"
CHANGE_STATE_PATH = DATA_DIR / "refresh_change_state.json"
# get_cookie.py needs browser_cookie3, only installed in this venv (not the interpreter running this script).
VENV_PYTHON = DATA_DIR / ".venv" / "bin" / "python3"
PROGRESS_PATH = DATA_DIR / "refresh_progress.json"
# Which event/ranking pages were force-refreshed and when - lets a run skip
# anyone refreshed recently instead of unconditionally re-fetching the entire
# current season's pages (event pages AND ranking pages) every single time,
# which only gets slower as the national scraper grows the current-season
# player pool. Keyed "event:{tournament_id}:{player_id}" / "ranking:{local_id}".
LAST_REFRESHED_PATH = DATA_DIR / "last_refreshed.json"


def write_progress(step: str, percent: float, detail: str = "", running: bool = True, error: str | None = None, unchanged: bool = False) -> None:
    payload = {
        "step": step,
        "percent": round(max(0, min(percent, 100)), 1),
        "detail": detail,
        "running": running,
        "error": error,
        "unchanged": unchanged,
    }
    PROGRESS_PATH.write_text(json.dumps(payload), encoding="utf-8")


# ASP.NET embeds a fresh __VIEWSTATE/__EVENTVALIDATION/random dropdown id on every
# single request regardless of whether the underlying match data changed; strip
# these before hashing or the hash would never repeat across two identical fetches.
VOLATILE_RE = re.compile(
    rb'(name="__VIEWSTATE"[^>]*value="[^"]*"'
    rb'|name="__EVENTVALIDATION"[^>]*value="[^"]*"'
    rb'|name="__VIEWSTATEGENERATOR"[^>]*value="[^"]*"'
    rb'|tst_[0-9a-fA-F-]{36})'
)


def has_changed(cookie: str) -> bool:
    """Fetch the current pool's drawmatches page and compare its hash (after
    stripping ASP.NET's per-request volatile tokens) against the last known one.
    Returns True if this looks like the first run or content differs."""
    url = f"https://badmintonnederland.toernooi.nl/sport/drawmatches.aspx?id={CURRENT_TOURNAMENT_ID}&draw={CHANGE_CHECK_DRAW_ID}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read()
    html = VOLATILE_RE.sub(b"", html)
    digest = hashlib.sha256(html).hexdigest()

    previous = None
    if CHANGE_STATE_PATH.exists():
        previous = json.loads(CHANGE_STATE_PATH.read_text(encoding="utf-8")).get("hash")

    CHANGE_STATE_PATH.write_text(json.dumps({"drawId": CHANGE_CHECK_DRAW_ID, "hash": digest}), encoding="utf-8")
    return previous != digest


def run(*cmd: str) -> None:
    print("$ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=DATA_DIR)


def run_with_progress(cmd: list[str], expected_paths: list[Path], step: str, base_pct: float, span_pct: float) -> None:
    print("$ " + " ".join(cmd), flush=True)
    target = len(expected_paths) or 1
    proc = subprocess.Popen(cmd, cwd=DATA_DIR)
    while proc.poll() is None:
        count = sum(1 for p in expected_paths if p.exists())
        pct = base_pct + (min(count, target) / target * span_pct)
        write_progress(step, pct, f"{min(count, target)}/{target}")
        time.sleep(1)
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)
    write_progress(step, base_pct + span_pct, f"{target}/{target}")


def load_last_refreshed() -> dict:
    if LAST_REFRESHED_PATH.exists():
        return json.loads(LAST_REFRESHED_PATH.read_text(encoding="utf-8"))
    return {}


def save_last_refreshed(state: dict) -> None:
    LAST_REFRESHED_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def is_stale(state: dict, key: str, min_refresh_days: float, now: datetime) -> bool:
    last = state.get(key)
    if last is None:
        return True
    return datetime.fromisoformat(last) < now - timedelta(days=min_refresh_days)


def refresh_cookie(cookie_file: Path, browser: str) -> None:
    """Pull a fresh session cookie from the local browser before scraping, so a
    stale cookie.txt never has to be manually refreshed via get_cookie.py."""
    python = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
    try:
        run(python, "get_cookie.py", "--browser", browser, "--save", str(cookie_file))
    except subprocess.CalledProcessError as ex:
        print(f"[refresh] could not refresh cookie from {browser} ({ex}); falling back to existing {cookie_file}", file=sys.stderr, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cookie-file", type=Path, default=DATA_DIR / "cookie.txt")
    parser.add_argument("--browser", default="chrome", help="Browser to pull the session cookie from (see get_cookie.py)")
    parser.add_argument(
        "--skip-cookie-refresh",
        action="store_true",
        help="Use --cookie-file as-is (e.g. one just written by playwright_login.py in CI) instead of pulling it from a local browser profile.",
    )
    parser.add_argument(
        "--min-refresh-days", type=float, default=3,
        help="Skip re-fetching an event/ranking page refreshed more recently than this many days ago",
    )
    args = parser.parse_args()

    try:
        if args.skip_cookie_refresh:
            write_progress("cookie", 3, "using supplied cookie file")
        else:
            write_progress("cookie", 1, "refreshing session cookie")
            refresh_cookie(args.cookie_file, args.browser)
            write_progress("cookie", 3, "cookie ready")

        cookie = args.cookie_file.read_text(encoding="utf-8").strip()
        write_progress("check", 4, "checking for new data")
        if not has_changed(cookie):
            write_progress("done", 100, "Data already updated.", running=False, unchanged=True)
            print("no changes detected, skipping fetch", flush=True)
            return
        write_progress("check", 5, "change detected, fetching")

        events = json.loads((DATA_DIR / "events_index.json").read_text(encoding="utf-8"))
        current_season = [e for e in events if e["tournament_id"] == CURRENT_TOURNAMENT_ID]

        now = datetime.now(timezone.utc)
        last_refreshed = load_last_refreshed()

        # Only force-refetch pages not refreshed within --min-refresh-days - the
        # rest keep whatever was already cached (fetch_events.py/fetch_rankings.py
        # skip files that already exist, so leaving a fresh-enough page alone is
        # exactly the same as "already up to date, nothing to do" for it). This is
        # what keeps a full-season refresh cheap as the current-season player
        # pool keeps growing, instead of re-fetching everyone every single run.
        events_to_refresh = [
            e for e in current_season
            if is_stale(last_refreshed, f"event:{e['tournament_id']}:{e['player_id']}", args.min_refresh_days, now)
        ]
        events_dir = DATA_DIR / "pages" / "events"
        for e in events_to_refresh:
            (events_dir / f"{e['tournament_id']}_{e['player_id']}.html").unlink(missing_ok=True)

        filtered_index = DATA_DIR / "events_index.current.json"
        filtered_index.write_text(json.dumps(events_to_refresh), encoding="utf-8")

        rankings_dir = DATA_DIR / "pages" / "rankings"
        rankings_dir.mkdir(parents=True, exist_ok=True)
        ranking_local_ids = discover_ranking_links(DATA_DIR / "pages")
        ranking_ids_to_refresh = {
            local_id for local_id in ranking_local_ids
            if is_stale(last_refreshed, f"ranking:{local_id}", args.min_refresh_days, now)
        }
        for local_id in ranking_ids_to_refresh:
            (rankings_dir / f"player_{local_id}.html").unlink(missing_ok=True)
        # The 3 category "top of list" pages are cheap - always keep them current.
        for cat in ("491", "493", "495"):
            (rankings_dir / f"category_{cat}.html").unlink(missing_ok=True)

        # Force build_career_db.py to reprocess every local page (local parsing only, no network cost).
        (DATA_DIR / "career.state.json").unlink(missing_ok=True)

        expected_event_paths = [events_dir / f"{e['tournament_id']}_{e['player_id']}.html" for e in events_to_refresh]
        expected_ranking_paths = [rankings_dir / f"player_{local_id}.html" for local_id in ranking_ids_to_refresh]
        expected_ranking_paths += [rankings_dir / f"category_{cat}.html" for cat in ("491", "493", "495")]

        try:
            run_with_progress(
                [sys.executable, "fetch_events.py", str(filtered_index), "--cookie-file", str(args.cookie_file), "--out", "pages/events"],
                expected_event_paths, "events", 3, 47,
            )
            run_with_progress(
                [sys.executable, "fetch_rankings.py", "--cookie-file", str(args.cookie_file), "--out", "pages/rankings"],
                expected_ranking_paths, "rankings", 50, 45,
            )
        finally:
            filtered_index.unlink(missing_ok=True)

        refreshed_at = now.isoformat()
        for e in events_to_refresh:
            last_refreshed[f"event:{e['tournament_id']}:{e['player_id']}"] = refreshed_at
        for local_id in ranking_ids_to_refresh:
            last_refreshed[f"ranking:{local_id}"] = refreshed_at
        save_last_refreshed(last_refreshed)

        write_progress("rebuild", 96, "rebuilding career.json")
        run(sys.executable, "build_career_db.py", "pages", "--out", "career.json")
        write_progress("rebuild", 98, "rebuilding rankings.json")
        run(sys.executable, "parse_rankings.py")

        write_progress("done", 100, "refresh complete", running=False)
        print("refresh complete", flush=True)
    except Exception as ex:  # surface the failure to pollers, then still fail the process
        write_progress("error", 100, str(ex), running=False, error=str(ex))
        raise


if __name__ == "__main__":
    main()
