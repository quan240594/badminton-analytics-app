#!/usr/bin/env python3
"""Fetch one draw's standings + full match results (scores, rounds, dates) from
badmintonnederland.toernooi.nl. Unlike the league system, everything needed to
simulate this draw's matches comes from two XHRs the draw.aspx page's own JS
fires - draw.aspx's plain HTML has no standings/match content at all:

    GET /tournament/{tid}/Draw/{draw_id}/GetStandings
    GET /tournament/{tid}/Draw/{draw_id}/GetMatchesContent?tabindex=1

Usage:
    python3 fetch_tournament_draw.py <tournament_id> <draw_id> --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

from safe_path import safe_path

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
}

# Header order (see GetStandings): GS=played, W=won, O=drawn, V=lost,
# then three compound "x-y" record strings (matches, games, rally points),
# and finally Pt = ranking points for this standing - table cells are
# positional, not named, so this has to line up with that exact order.
STANDING_ROW_RE = re.compile(
    r'<span class="standing-status">(\d+)</span>.*?'
    r'</td>\s*<td class="sticky-col-2[^"]*">(.*?)</td>\s*(.*?)</tr>',
    re.DOTALL,
)
STANDING_PLAYER_RE = re.compile(r'/Player/(\d+)"[^>]*><span class="nav-link__value">([^<]+)</span>')
STANDING_CELL_RE = re.compile(r'<td class="cell-points">\s*([^<]*?)\s*</td>')
STANDING_CELL_NAMES = ["played", "won", "drawn", "lost", "match_record", "game_record", "points_record", "ranking_points"]

MATCH_SPLIT_RE = re.compile(r'<li class="match-group__item" id="match_(\d+)">')
ROUND_RE = re.compile(r'title="(Ronde[^"]*)"')
SIDE_SPLIT_RE = re.compile(r'<div class="match__row( has-won)?\s*">')
PLAYER_RE = re.compile(r'data-player-id="(\d+)"[^>]*data-nationality-id="([A-Z]*)"[^>]*><span class="nav-link__value">([^<]+)</span>')
GAME_RE = re.compile(r'<ul class="points">\s*<li class="points__cell[^"]*">\s*(\d+)\s*</li>\s*<li class="points__cell[^"]*">\s*(\d+)\s*</li>')
DATE_RE = re.compile(r'<span class="nav-link__value">(\w{2} \d{1,2}-\d{1,2}-\d{4} \d{2}:\d{2})</span>')

# The tournament-scoped player.aspx page has no ranking-list link at all (that
# widget is apparently league-context-only) - but each match's head-2-head
# button embeds every player's site-wide MemberID, which the existing
# rankings.json pipeline's ranking/player.aspx?rid=..&player=<id> URLs use.
# This is the only place that global id is exposed for a plain tournament.
H2H_MEMBER_ID_RE = re.compile(r'T\dP\dMemberID=(\d+)')


def fetch(url: str, cookie: str) -> str:
    req = urllib.request.Request(url, headers={**BROWSER_HEADERS, "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_standings(html: str) -> list[dict]:
    standings = []
    for rank, players_block, rest in STANDING_ROW_RE.findall(html):
        players = [{"player_id": pid, "name": name} for pid, name in STANDING_PLAYER_RE.findall(players_block)]
        cells = STANDING_CELL_RE.findall(rest)
        row = dict(zip(STANDING_CELL_NAMES, cells))
        for key in ("played", "won", "drawn", "lost", "ranking_points"):
            if key in row and row[key].strip().lstrip("-").isdigit():
                row[key] = int(row[key])
        standings.append({"rank": int(rank), "players": players, **row})
    return standings


def parse_matches(html: str) -> list[dict]:
    matches = []
    blocks = MATCH_SPLIT_RE.split(html)
    for match_id, block in zip(blocks[1::2], blocks[2::2]):
        round_match = ROUND_RE.search(block)
        # Split into the two match__row sides; players/won-flag come from
        # whichever side of this split marker each entry falls on.
        side_parts = SIDE_SPLIT_RE.split(block)[1:]  # [flag, body, flag, body, ...]
        sides = []
        for won_flag, body in zip(side_parts[0::2], side_parts[1::2]):
            players = [{"player_id": pid, "name": name} for pid, _country, name in PLAYER_RE.findall(body)]
            sides.append({"won": won_flag == " has-won", "players": players})
        games = GAME_RE.findall(block)
        date_match = DATE_RE.search(block.split("match__footer", 1)[-1]) if "match__footer" in block else None

        # Zip the h2h link's T1P1/T1P2/T2P1/T2P2 MemberIDs against the same
        # players in document order - both lists follow the same side-by-side
        # rendering order, there's no other shared key to join on here.
        member_ids = H2H_MEMBER_ID_RE.findall(block)
        all_players = [player for side in sides for player in side["players"]]
        for player, member_id in zip(all_players, member_ids):
            player["member_id"] = member_id

        matches.append(
            {
                "match_id": match_id,
                "round": round_match.group(1) if round_match else None,
                "sides": sides,
                "games": [[int(a), int(b)] for a, b in games],
                "played_at": date_match.group(1) if date_match else None,
            }
        )
    return matches


def fetch_draw(tournament_id: str, draw_id: str, cookie: str) -> dict:
    tid_lower = tournament_id.lower()
    standings_html = fetch(f"https://badmintonnederland.toernooi.nl/tournament/{tid_lower}/Draw/{draw_id}/GetStandings?X-Requested-With=XMLHttpRequest", cookie)
    matches_html = fetch(f"https://badmintonnederland.toernooi.nl/tournament/{tid_lower}/Draw/{draw_id}/GetMatchesContent?tabindex=1&X-Requested-With=XMLHttpRequest", cookie)
    return {"standings": parse_standings(standings_html), "matches": parse_matches(matches_html)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tournament_id")
    parser.add_argument("draw_id")
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--out", type=Path, default=Path("tournament_draws_data.json"))
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)
    args.out = safe_path(args.out)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    draw = fetch_draw(args.tournament_id, args.draw_id, cookie)

    all_draws = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else {}
    all_draws.setdefault(args.tournament_id.upper(), {})[args.draw_id] = draw
    args.out.write_text(json.dumps(all_draws, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Done. {len(draw['standings'])} standings rows, {len(draw['matches'])} matches for draw {args.draw_id}")


if __name__ == "__main__":
    main()
