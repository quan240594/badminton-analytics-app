#!/usr/bin/env python3
"""Combine clubs.json + draw_teams.json + region_map.py into league_index.json:
a Region -> Division -> Afdeling (pool) tree the app's selectors are built from.

Usage:
    python3 build_league_index.py
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from region_map import region_for_city  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent


def normalize(name: str) -> str:
    # Strip a trailing team-number suffix, e.g. "DROP SHOT BC M1" / "DROP SHOT BC  1" -> "DROP SHOT BC".
    name = re.sub(r"\s+[A-Za-z]{0,2}\d+$", "", name.strip())
    return re.sub(r"\s+", " ", name).strip().upper()


def main() -> None:
    clubs = json.loads((DATA_DIR / "clubs.json").read_text(encoding="utf-8"))
    draw_teams = json.loads((DATA_DIR / "draw_teams.json").read_text(encoding="utf-8"))

    club_by_name = {normalize(c["name"]): {"clubId": cid, **c} for cid, c in clubs.items()}

    afdelingen = []
    unmatched_teams: set[str] = set()
    for draw_id, info in draw_teams.items():
        teams = []
        for team_name in info["teams"]:
            club = club_by_name.get(normalize(team_name))
            if club:
                teams.append({"name": team_name, "clubId": club["clubId"], "city": club.get("city")})
            else:
                unmatched_teams.add(team_name)
                teams.append({"name": team_name, "clubId": None, "city": None})

        region_votes = Counter(region_for_city(t["city"]) for t in teams if t["city"])
        region = region_votes.most_common(1)[0][0] if region_votes else "Onbekend"

        afdelingen.append(
            {
                "drawId": draw_id,
                "division": info["division"],
                "label": info["afdelingLabel"],
                "region": region,
                "teams": teams,
            }
        )

    afdelingen.sort(key=lambda a: (a["division"], a["label"]))

    divisions: dict[str, list] = {}
    for a in afdelingen:
        divisions.setdefault(a["division"], []).append(a)

    regions = sorted({a["region"] for a in afdelingen})

    output = {"regions": regions, "divisions": divisions}
    (DATA_DIR / "league_index.json").write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"wrote league_index.json: {len(afdelingen)} afdelingen across {len(divisions)} divisions, {len(regions)} regions")
    print("regions:", regions)
    if unmatched_teams:
        print(f"\n{len(unmatched_teams)} team names could not be matched to a club (region left unset for their afdeling votes):")
        for t in sorted(unmatched_teams):
            print(" -", t)


if __name__ == "__main__":
    main()
