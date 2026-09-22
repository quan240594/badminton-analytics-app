#!/usr/bin/env python3
"""Parse fetched toernooi.nl pages into a full player database with singles/doubles
performance, matchup history, and opponent scouting info.

Usage:
    python3 parse_players.py pages/ --json players.json
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

PLAYER_LINK_RE = re.compile(
    r'<a href="player\.aspx\?id=[^"]*&player=(\d+)">([^<]+)</a>', re.IGNORECASE
)
STRONG_PLAYER_RE = re.compile(
    r'<strong><a href="player\.aspx\?id=[^"]*&player=(\d+)">([^<]+)</a></strong>', re.IGNORECASE
)


@dataclass
class RubberResult:
    match_id: str
    round_teams: tuple[str, str]  # (home_team_name, away_team_name)
    rubber: str  # MS1..MS4, MD1..MD4
    home_players: list[tuple[str, str]]  # (player_id, name)
    away_players: list[tuple[str, str]]
    winner_side: str  # "home" or "away"
    game_scores: str


@dataclass
class PlayerRecord:
    player_id: str
    name: str
    team: str = ""
    overall_rank: int | None = None
    overall_won: int | None = None
    overall_played: int | None = None
    singles: list[RubberResult] = field(default_factory=list)
    doubles: list[RubberResult] = field(default_factory=list)

    def singles_record(self) -> tuple[int, int]:
        won = sum(1 for r in self.singles if self._won(r))
        return won, len(self.singles)

    def doubles_record(self) -> tuple[int, int]:
        won = sum(1 for r in self.doubles if self._won(r))
        return won, len(self.doubles)

    def _won(self, r: RubberResult) -> bool:
        is_home = any(pid == self.player_id for pid, _ in r.home_players)
        return (is_home and r.winner_side == "home") or (not is_home and r.winner_side == "away")


def parse_overall_stats(playerstats_path: Path) -> dict[str, PlayerRecord]:
    html = playerstats_path.read_text(encoding="utf-8", errors="replace")
    players: dict[str, PlayerRecord] = {}
    row_re = re.compile(
        r'<td>(\d+)</td><td><a href="player\.aspx\?id=[^"]*&player=(\d+)">([^<]+)</a></td>'
        r'<td><a href="teamplayerstats\.aspx\?id=[^"]*&team=\d+">([^<]+)</a></td>'
        r'<td>(\d+)</td><td>(\d+)</td>'
    )
    for m in row_re.finditer(html):
        rank, player_id, name, team, won, played = m.groups()
        players[player_id] = PlayerRecord(
            player_id=player_id,
            name=name,
            team=team,
            overall_rank=int(rank),
            overall_won=int(won),
            overall_played=int(played),
        )
    return players


def extract_team_names(html: str) -> tuple[str, str]:
    m = re.search(
        r'<h3><a href="[^"]*team=\d+">([^<]+)</a> - <a href="[^"]*team=\d+">([^<]+)</a>', html
    )
    if m:
        return m.group(1), m.group(2)
    return "Home", "Away"


def parse_match_file(match_path: Path) -> list[RubberResult]:
    html = match_path.read_text(encoding="utf-8", errors="replace")
    match_id = match_path.stem.replace("match_", "")
    home_team, away_team = extract_team_names(html)

    results: list[RubberResult] = []
    # Split on rubber rows: <td>MS1</td>...<td>MS2</td>... etc.
    row_re = re.compile(
        r'<td>(M[SD]\d)</td><td align="right"><table align="Right">(.*?)</table></td>'
        r'<td align="center">-</td><td><table>(.*?)</table></td>'
        r'<td><span class="score">(.*?)</span></td>',
        re.DOTALL,
    )
    for m in row_re.finditer(html):
        rubber, home_block, away_block, score_block = m.groups()

        home_players = PLAYER_LINK_RE.findall(home_block)
        away_players = PLAYER_LINK_RE.findall(away_block)
        home_winners = STRONG_PLAYER_RE.findall(home_block)
        away_winners = STRONG_PLAYER_RE.findall(away_block)

        if home_winners:
            winner_side = "home"
        elif away_winners:
            winner_side = "away"
        else:
            continue  # unplayed / no result yet

        game_scores = re.sub(r"<[^>]+>", " ", score_block).strip()
        game_scores = re.sub(r"\s+", " ", game_scores)

        results.append(
            RubberResult(
                match_id=match_id,
                round_teams=(home_team, away_team),
                rubber=rubber,
                home_players=[(pid, name) for pid, name in home_players],
                away_players=[(pid, name) for pid, name in away_players],
                winner_side=winner_side,
                game_scores=game_scores,
            )
        )
    return results


def build_database(pages_dir: Path) -> dict[str, PlayerRecord]:
    playerstats_path = pages_dir / "playerstats.html"
    players = parse_overall_stats(playerstats_path) if playerstats_path.exists() else {}

    for match_path in sorted(pages_dir.glob("match_*.html")):
        for rubber in parse_match_file(match_path):
            all_ids = rubber.home_players + rubber.away_players
            for pid, name in all_ids:
                if pid not in players:
                    players[pid] = PlayerRecord(player_id=pid, name=name)
                if rubber.rubber.startswith("MS"):
                    players[pid].singles.append(rubber)
                else:
                    players[pid].doubles.append(rubber)
    return players


def to_json(players: dict[str, PlayerRecord]) -> dict:
    out = {}
    for pid, p in players.items():
        sw, sp = p.singles_record()
        dw, dp = p.doubles_record()
        out[pid] = {
            "name": p.name,
            "team": p.team,
            "overall_rank": p.overall_rank,
            "overall_won_played": [p.overall_won, p.overall_played],
            "singles_won_played": [sw, sp],
            "doubles_won_played": [dw, dp],
            "singles_matches": [
                {
                    "match_id": r.match_id,
                    "teams": r.round_teams,
                    "opponent": next((n for i, n in r.away_players if i != pid), None)
                    or next((n for i, n in r.home_players if i != pid), None),
                    "won": (
                        (r.winner_side == "home" and any(i == pid for i, _ in r.home_players))
                        or (r.winner_side == "away" and any(i == pid for i, _ in r.away_players))
                    ),
                    "score": r.game_scores,
                }
                for r in p.singles
            ],
            "doubles_matches": [
                {
                    "match_id": r.match_id,
                    "teams": r.round_teams,
                    "partner": next(
                        (n for i, n in (r.home_players + r.away_players) if i != pid and (i, n) in (r.home_players if any(x == pid for x, _ in r.home_players) else r.away_players)),
                        None,
                    ),
                    "opponents": [n for i, n in (r.away_players if any(x == pid for x, _ in r.home_players) else r.home_players)],
                    "won": (
                        (r.winner_side == "home" and any(i == pid for i, _ in r.home_players))
                        or (r.winner_side == "away" and any(i == pid for i, _ in r.away_players))
                    ),
                    "score": r.game_scores,
                }
                for r in p.doubles
            ],
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pages_dir", type=Path, help="Directory of fetched pages")
    parser.add_argument("--json", type=Path, help="Write full player database as JSON")
    parser.add_argument("--player", help="Show detail for one player name (substring match)")
    args = parser.parse_args()

    players = build_database(args.pages_dir)
    data = to_json(players)

    if args.json:
        args.json.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {len(data)} players to {args.json}")

    if args.player:
        needle = args.player.lower()
        for pid, p in data.items():
            if needle in p["name"].lower():
                print(json.dumps({pid: p}, indent=2, ensure_ascii=False))
        return

    # Default: print singles leaderboard
    ranked = sorted(
        data.items(), key=lambda kv: (-kv[1]["singles_won_played"][0], kv[1]["name"])
    )
    print(f"\n=== Men's Singles performance ({len(ranked)} players with singles data) ===")
    for pid, p in ranked:
        sw, sp = p["singles_won_played"]
        if sp == 0:
            continue
        print(f"  {p['name']:30s} ({p['team']:28s}) singles: {sw}-{sp - sw}  (rank overall: {p['overall_rank']})")


if __name__ == "__main__":
    main()
