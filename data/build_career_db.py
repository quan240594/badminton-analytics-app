#!/usr/bin/env python3
"""Incrementally parse fetched player pages (current season + historical events)
into a unified career database, keyed by the stable player-profile GUID so the
same real person is linked across all their different per-tournament player IDs.

Safe to re-run repeatedly / run in a watch loop: tracks already-parsed files in
parsed_state.json and only processes new ones each pass, so it can run
concurrently with fetch_events.py for a real-time ETL pipeline.

Usage:
    python3 build_career_db.py pages/ --out career.json
    python3 build_career_db.py pages/ --out career.json --watch 15 --until-count 1088
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import asdict
from pathlib import Path

from parse_career import parse_player_file

from season import resolve_current_tournament_id  # noqa: E402

CURRENT_TOURNAMENT_ID = resolve_current_tournament_id("9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E")


def discover_files(pages_dir: Path) -> list[tuple[Path, str, str]]:
    """Returns list of (path, tournament_id, player_id) for every fetched player page."""
    out: list[tuple[Path, str, str]] = []
    for p in sorted(pages_dir.glob("player_*.html")):
        m = re.match(r"player_(\d+)\.html", p.name)
        if m:
            out.append((p, CURRENT_TOURNAMENT_ID, m.group(1)))
    events_dir = pages_dir / "events"
    if events_dir.exists():
        for p in sorted(events_dir.glob("*.html")):
            m = re.match(r"([0-9A-Fa-f-]+)_(\d+)\.html", p.name)
            if m:
                out.append((p, m.group(1), m.group(2)))
    return out


def load_state(state_path: Path) -> dict:
    if state_path.exists():
        return json.loads(state_path.read_text(encoding="utf-8"))
    return {"parsed_files": [], "players": {}}


def save_state(state_path: Path, state: dict) -> None:
    state_path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def run_pass(pages_dir: Path, state: dict) -> int:
    parsed_set = set(state["parsed_files"])
    new_count = 0
    for path, tid, pid in discover_files(pages_dir):
        key = str(path.relative_to(pages_dir))
        if key in parsed_set:
            continue
        try:
            info = parse_player_file(path, tid, pid)
        except Exception as e:
            print(f"WARN: failed to parse {path}: {e}")
            parsed_set.add(key)
            continue

        guid = info.profile_guid or f"noguid:{info.name}"
        player_entry = state["players"].setdefault(
            guid,
            {"name": info.name, "member_id": info.member_id, "club": info.club, "aliases": {}, "matches": []},
        )
        # Track every (tournament_id, player_id, name, club) this real person has used.
        alias_key = f"{tid}:{pid}"
        player_entry["aliases"][alias_key] = {"name": info.name, "club": info.club}
        if info.club:
            player_entry["club"] = info.club  # keep most-recently-seen club as current

        for match in info.matches:
            player_entry["matches"].append(asdict(match))

        parsed_set.add(key)
        new_count += 1

    state["parsed_files"] = sorted(parsed_set)
    return new_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pages_dir", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="Output career database JSON")
    parser.add_argument("--state", type=Path, default=None, help="State file (default: <out>.state.json)")
    parser.add_argument("--watch", type=float, default=None, help="Re-scan every N seconds instead of running once")
    parser.add_argument("--until-count", type=int, default=None, help="With --watch, stop once this many files are parsed")
    args = parser.parse_args()

    state_path = args.state or args.out.with_suffix(".state.json")
    state = load_state(state_path)

    def write_output():
        args.out.write_text(json.dumps(state["players"], indent=2, ensure_ascii=False), encoding="utf-8")

    if args.watch is None:
        new = run_pass(args.pages_dir, state)
        save_state(state_path, state)
        write_output()
        print(f"Parsed {new} new files. Total files parsed: {len(state['parsed_files'])}. Players: {len(state['players'])}")
        return

    print(f"Watching {args.pages_dir} every {args.watch}s ... (Ctrl+C to stop)")
    while True:
        new = run_pass(args.pages_dir, state)
        save_state(state_path, state)
        write_output()
        total = len(state["parsed_files"])
        if new:
            print(f"[{time.strftime('%H:%M:%S')}] +{new} new -> total parsed {total}, players {len(state['players'])}")
        if args.until_count and total >= args.until_count:
            print(f"Reached target of {args.until_count} parsed files. Stopping.")
            break
        time.sleep(args.watch)


if __name__ == "__main__":
    main()
