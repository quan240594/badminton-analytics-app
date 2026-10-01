#!/usr/bin/env python3
"""Parse fetched ranking pages into rankings.json: each player's current national
rank/points per discipline, plus the #1-ranked player's points per discipline."""

from __future__ import annotations

import json
import re
from pathlib import Path

# Category ids are gender-specific for singles/doubles (491=Mannen Enkel,
# 492=Vrouwen Enkel, 493=Mannen Dubbel, 494=Vrouwen Dubbel) but shared for mixed
# (495=Gemengd Dubbel) - missing 492/494 here silently dropped every woman's
# singles/doubles ranking (only mixed ever parsed for them).
CATEGORY_TO_DISCIPLINE = {"491": "singles", "492": "singles", "493": "doubles", "494": "doubles", "495": "mixed"}

SUMMARY_ROW_RE = re.compile(
    r'<td><a href="category\.aspx\?id=\d+&category=(\d+)">[^<]*</a></td>'
    r'<td class="rank"><div style="">(\d+)</div></td>.*?'
    r'<td class="right rankingpoints">(\d+)</td>'
)

TOP_ROW_RE = re.compile(
    r'<td class="rank"><div style="">1</div></td>.*?'
    r'<td><a href="player\.aspx\?id=\d+&player=\d+">([^<]+)</a></td>'
    r'<td>\d+</td><td class="right rankingpoints">(\d+)</td>'
)


def parse_player_file(path: Path) -> dict:
    html = path.read_text(encoding="utf-8", errors="replace")
    result: dict[str, dict] = {}
    for m in SUMMARY_ROW_RE.finditer(html):
        category, rank, points = m.groups()
        discipline = CATEGORY_TO_DISCIPLINE.get(category)
        if discipline:
            result[discipline] = {"rank": int(rank), "points": int(points)}
    return result


def parse_top_player(path: Path) -> dict | None:
    html = path.read_text(encoding="utf-8", errors="replace")
    m = TOP_ROW_RE.search(html)
    if not m:
        return None
    name, points = m.groups()
    return {"name": name, "points": int(points)}


def load_existing(out_path: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    if not out_path.exists():
        return {}, {}
    existing = json.loads(out_path.read_text(encoding="utf-8"))
    return existing.get("players", {}), existing.get("top", {})


def main() -> None:
    rankings_dir = Path("pages/rankings")
    out_path = Path("rankings.json")
    # Two separate workflows (league + tournament) both call this script, each
    # only ever seeing whichever ranking pages IT just fetched this run (pages/
    # isn't persisted between runs) - rebuilding players/top from scratch here
    # would silently wipe out everything the other pipeline (or an earlier run
    # of this same one) had already contributed. Merge into what's already
    # committed instead, so coverage only ever grows.
    players, top = load_existing(out_path)
    newly_parsed = 0
    for path in sorted(rankings_dir.glob("player_*.html")):
        local_id = path.stem.split("_", 1)[1]
        parsed = parse_player_file(path)
        if parsed:
            players[local_id] = parsed
            newly_parsed += 1

    for category, discipline in CATEGORY_TO_DISCIPLINE.items():
        path = rankings_dir / f"category_{category}.html"
        if path.exists():
            top_player = parse_top_player(path)
            if top_player:
                top[discipline] = top_player

    output = {"players": players, "top": top}
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Parsed {newly_parsed} players with ranking data this run ({len(players)} total)")
    print(f"Top players: {top}")


if __name__ == "__main__":
    main()
