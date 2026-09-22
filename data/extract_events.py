#!/usr/bin/env python3
"""Extract every historical event/tournament entry from fetched player pages.

Each player.aspx page has an "Events with X" section listing every tournament
the player has ever entered, each with its own tournament id + player id pair
(different from the current league's id/player). This script collects all of
those pairs across all fetched player pages into one deduped index.

Usage:
    python3 extract_events.py pages/ --json events_index.json
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

EVENT_LINK_RE = re.compile(
    r'<a href="\.\./player\.aspx\?id=([0-9A-Fa-f-]+)&player=(\d+)">([^<]+)</a>'
)
YEAR_HEADER_RE = re.compile(r'<th colspan="2">(\d{4})</th>')
DATES_RE = re.compile(r'<td class="dates">([^<]*)</td>')


def extract_source_player(html: str) -> tuple[str, str] | None:
    m = re.search(r"<h2>\s*([^<]+?)\s*<a href=\"/player-profile/", html)
    name = m.group(1).strip() if m else None
    m2 = re.search(r"Match overview.*?id=([0-9A-Fa-f-]+)&id=(\d+)&LCID", html, re.DOTALL)
    return name, None


def parse_player_file(path: Path) -> list[dict]:
    html_text = path.read_text(encoding="utf-8", errors="replace")
    name_match = re.search(r"<h2>\s*([^<]+?)\s*<a href=\"/player-profile/", html_text)
    source_name = html.unescape(name_match.group(1).strip()) if name_match else path.stem

    # Isolate the "Events with X" tabbed section to avoid picking up unrelated links.
    events_section_match = re.search(r"Events with.*?</div>\s*</div>", html_text, re.DOTALL)
    section = events_section_match.group(0) if events_section_match else ""

    events: list[dict] = []
    for m in EVENT_LINK_RE.finditer(section):
        tid, pid, event_name = m.groups()
        events.append(
            {
                "source_player_file": path.stem,
                "source_player_name": source_name,
                "tournament_id": tid,
                "player_id": pid,
                "event_name": html.unescape(event_name.strip()),
            }
        )
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pages_dir", type=Path)
    parser.add_argument("--json", type=Path, required=True)
    args = parser.parse_args()

    all_events: list[dict] = []
    for path in sorted(args.pages_dir.glob("player_*.html")):
        all_events.extend(parse_player_file(path))

    # Dedupe by (tournament_id, player_id) - same historical entry can appear
    # on multiple current players' pages if they were teammates back then.
    seen: dict[tuple[str, str], dict] = {}
    for e in all_events:
        key = (e["tournament_id"], e["player_id"])
        if key not in seen:
            seen[key] = e

    unique = list(seen.values())
    args.json.write_text(json.dumps(unique, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Found {len(all_events)} event references, {len(unique)} unique (tournament_id, player_id) pairs")
    print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
