#!/usr/bin/env python3
"""Parse a single player.aspx-style page (current season or historical event)
into player metadata + a list of match records.

Works uniformly across event types (league seasons, open tournaments, club
championships) because every player page uses the same player-centric
"Match overview" table, regardless of what kind of draw it came from.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

PLAYER_LINK_RE = re.compile(r'<a href="[^"]*player\.aspx\?id=[^"]*&player=(\d+)">([^<]+)</a>')
STRONG_PLAYER_RE = re.compile(r'<strong>\s*<a[^>]*href="[^"]*player\.aspx\?id=[^"]*&player=(\d+)">([^<]+)</a>\s*</strong>')
TEAM_NAME_RE = re.compile(r'<a[^>]*class="teamname"[^>]*>([^<]+)</a>')
STRONG_TEAM_RE = re.compile(r'<strong>\s*<a[^>]*class="teamname"[^>]*>([^<]+)</a>\s*</strong>')

ROW_RE = re.compile(
    r'<td align="right">(?P<time>.*?)</td><td>(?P<event>[^<]*)</td><td>(?P<draw>.*?)</td>'
    r'<td class="nowrap" align="right">(?P<home>.*?)</td><td align="center">-</td>'
    r'<td class="nowrap">(?P<away>.*?)</td><td><span class="score">(?P<score>.*?)</span></td>',
    re.DOTALL,
)

PROFILE_RE = re.compile(r'<h2>\s*([^<]+?)\s*<a href="/player-profile/([0-9A-Fa-f-]+)"', re.DOTALL)
MEMBER_ID_RE = re.compile(r'<th>Member ID:</th><td>(\d+)</td>')
CLUB_RE = re.compile(r'<th>Club:</th><td><a[^>]*>([^<]+)</a></td>')


@dataclass
class MatchRecord:
    tournament_id: str
    source_player_id: str
    time: str
    event: str
    draw: str
    home_team: str
    home_players: list
    away_team: str
    away_players: list
    score: str
    winner_side: str  # "home", "away", or "" if unplayed/unknown


@dataclass
class PlayerPageInfo:
    tournament_id: str
    player_id: str
    name: str
    profile_guid: str | None
    member_id: str | None
    club: str | None
    matches: list = field(default_factory=list)


def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def parse_side(block: str) -> tuple[str, list, bool]:
    """Returns (team_name, [(player_id, name), ...], won)."""
    strong_team = STRONG_TEAM_RE.search(block)
    team_name = strong_team.group(1) if strong_team else (TEAM_NAME_RE.search(block).group(1) if TEAM_NAME_RE.search(block) else "")
    players = PLAYER_LINK_RE.findall(block)
    won = bool(strong_team) or bool(STRONG_PLAYER_RE.search(block))
    return team_name, players, won


def parse_player_file(path: Path, tournament_id: str, player_id: str) -> PlayerPageInfo:
    html = path.read_text(encoding="utf-8", errors="replace")

    profile_match = PROFILE_RE.search(html)
    name = profile_match.group(1).strip() if profile_match else path.stem
    guid = profile_match.group(2) if profile_match else None
    member_match = MEMBER_ID_RE.search(html)
    member_id = member_match.group(1) if member_match else None
    club_match = CLUB_RE.search(html)
    club = club_match.group(1) if club_match else None

    info = PlayerPageInfo(
        tournament_id=tournament_id,
        player_id=player_id,
        name=name,
        profile_guid=guid,
        member_id=member_id,
        club=club,
    )

    overview_match = re.search(r"Match overview.*?<tbody>(.*?)</tbody>", html, re.DOTALL)
    if not overview_match:
        return info
    overview_html = overview_match.group(1)

    for m in ROW_RE.finditer(overview_html):
        home_team, home_players, home_won = parse_side(m.group("home"))
        away_team, away_players, away_won = parse_side(m.group("away"))
        winner_side = "home" if home_won else ("away" if away_won else "")
        info.matches.append(
            MatchRecord(
                tournament_id=tournament_id,
                source_player_id=player_id,
                time=strip_tags(m.group("time")),
                event=m.group("event").strip(),
                draw=strip_tags(m.group("draw")),
                home_team=home_team,
                home_players=home_players,
                away_team=away_team,
                away_players=away_players,
                score=strip_tags(m.group("score")),
                winner_side=winner_side,
            )
        )
    return info
