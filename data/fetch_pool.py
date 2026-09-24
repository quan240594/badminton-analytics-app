#!/usr/bin/env python3
"""On-demand fetch of one specific afdeling/pool's player rosters + match
history, for the region/division/pool browser. Delegates match/player
discovery and new-player fetching to pool_fetch_core.fetch_pool_players
(shared with the national all-pools driver), then - because a single
on-demand fetch should stay immediately fresh and the cost is trivial for one
pool - always does a full career.state.json delete + rebuild and records the
pool in fetched_pools.json right away.

Writes live progress to pool_fetch_progress.json (same shape as
refresh_data.py's refresh_progress.json) so a caller can poll real percentages.

Usage:
    python3 fetch_pool.py --draw-id 12 [--cookie-file cookie.txt]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from pool_fetch_core import fetch_pool_players

DATA_DIR = Path(__file__).resolve().parent
PROGRESS_PATH = DATA_DIR / "pool_fetch_progress.json"
FETCHED_POOLS_PATH = DATA_DIR / "fetched_pools.json"


def write_progress(step: str, percent: float, detail: str = "", running: bool = True, error: str | None = None) -> None:
    PROGRESS_PATH.write_text(
        json.dumps({"step": step, "percent": round(max(0, min(percent, 100)), 1), "detail": detail, "running": running, "error": error}),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draw-id", required=True)
    parser.add_argument("--cookie-file", type=Path, default=DATA_DIR / "cookie.txt")
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()

    try:
        new_count = fetch_pool_players(args.draw_id, cookie, args.cookie_file, args.delay, write_progress)

        write_progress("rebuild", 92, "rebuilding career.json")
        (DATA_DIR / "career.state.json").unlink(missing_ok=True)
        subprocess.run([sys.executable, "build_career_db.py", "pages", "--out", "career.json"], check=True, cwd=DATA_DIR)

        fetched = {}
        if FETCHED_POOLS_PATH.exists():
            fetched = json.loads(FETCHED_POOLS_PATH.read_text(encoding="utf-8"))
        fetched[args.draw_id] = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        FETCHED_POOLS_PATH.write_text(json.dumps(fetched, indent=2), encoding="utf-8")

        write_progress("done", 100, f"fetched {new_count} new players", running=False)
        print("pool fetch complete", flush=True)
    except Exception as ex:
        write_progress("error", 100, str(ex), running=False, error=str(ex))
        raise


if __name__ == "__main__":
    main()
