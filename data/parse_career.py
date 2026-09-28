#!/usr/bin/env python3
"""Parse a single player.aspx-style page (current season or historical event)
into player metadata + a list of match records.

Works uniformly across event types (league seasons, open tournaments, club
championships) because every player page uses the same player-centric
"Match overview" table, regardless of what kind of draw it came from.
"""

from __future__ import annotations

import html
import json
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

# toernooi.nl redesigned standalone-tournament pages (opens, club championships) onto a
# different template than the classic league player.aspx above - same underlying data,
# but rendered as "<div class="match">" cards instead of a "Match overview" <table>.
# League pages haven't been migrated yet, so both templates are live at once.
NEW_MATCH_ITEM_SPLIT_RE = re.compile(r'<li class="match-group__item">')
NEW_DRAW_LABEL_RE = re.compile(
    r'draw\.aspx\?id=[^"&]*&amp;draw=\d+"[^>]*>\s*<span class="nav-link__value">([^<]+)</span>'
)
NEW_MATCH_TIME_RE = re.compile(r'<span class="nav-link__value">(\w{3} \d{2}/\d{2}/\d{4} \d{2}:\d{2})</span>')
NEW_MATCH_ROW_SPLIT_RE = re.compile(r'<div class="match__row( has-won)?\s*">')
NEW_MATCH_PLAYER_RE = re.compile(
    r'data-player-id="(\d+)"[^>]*>\s*<span class="nav-link__value">(.*?)</span>\s*</a>', re.DOTALL
)
NEW_POINTS_UL_RE = re.compile(r'<ul class="points">(.*?)</ul>', re.DOTALL)
NEW_POINTS_CELL_RE = re.compile(r'<li class="points__cell[^"]*">\s*(\d+)\s*</li>')


def parse_new_template_matches(html_text: str, tournament_id: str, player_id: str) -> list:
    """Parses the redesigned "<div class="match">" card layout used by standalone
    tournaments (see module docstring for why this differs from ROW_RE)."""
    matches = []
    for chunk in NEW_MATCH_ITEM_SPLIT_RE.split(html_text)[1:]:
        draw_match = NEW_DRAW_LABEL_RE.search(chunk)
        event = html.unescape(draw_match.group(1).strip()) if draw_match else ""
        time_match = NEW_MATCH_TIME_RE.search(chunk)
        time = time_match.group(1) if time_match else ""

        parts = NEW_MATCH_ROW_SPLIT_RE.split(chunk)
        if len(parts) < 5:
            continue  # unexpected shape (e.g. a bye) - skip rather than guess
        home_won, away_won = parts[1] is not None, parts[3] is not None
        home_players = [(pid, html.unescape(strip_tags(nm))) for pid, nm in NEW_MATCH_PLAYER_RE.findall(parts[2])]
        away_players = [(pid, html.unescape(strip_tags(nm))) for pid, nm in NEW_MATCH_PLAYER_RE.findall(parts[4])]
        if not home_players or not away_players:
            continue

        sets = []
        for points_ul in NEW_POINTS_UL_RE.findall(chunk):
            cells = NEW_POINTS_CELL_RE.findall(points_ul)
            if len(cells) == 2:
                sets.append(f"{cells[0]}-{cells[1]}")

        matches.append(
            MatchRecord(
                tournament_id=tournament_id,
                source_player_id=player_id,
                time=time,
                event=event,
                draw="",
                home_team="",
                home_players=home_players,
                away_team="",
                away_players=away_players,
                score=" ".join(sets),
                winner_side=winner_side_of(home_won, away_won),
            )
        )
    return matches

PROFILE_RE = re.compile(r'<h2>\s*([^<]+?)\s*<a href="/player-profile/([0-9A-Fa-f-]+)"', re.DOTALL)
MEMBER_ID_RE = re.compile(r'<th>Member ID:</th><td>(\d+)</td>')
CLUB_RE = re.compile(r'<th>Club:</th><td><a[^>]*>([^<]+)</a></td>')

# The source site inconsistently shows a club's short vs. full name across pages
# (e.g. "BBS" vs "BBS BODEGRAVEN" for the same club); canonicalize known aliases here.
CLUB_ALIASES = {
    "BBS": "BBS BODEGRAVEN",
}

# clubs.json holds the canonical (uppercase) club names; used below to fix casing.
_CLUBS_JSON_PATH = Path(__file__).parent / "clubs.json"
_CANONICAL_CLUB_NAMES = {
    entry["name"].lower(): entry["name"]
    for entry in json.loads(_CLUBS_JSON_PATH.read_text(encoding="utf-8")).values()
}


def normalize_club(club: str | None) -> str | None:
    if club is None:
        return None
    club = club.strip()
    club = CLUB_ALIASES.get(club, club)
    # Source site renders the same club's name with inconsistent casing across page types.
    return _CANONICAL_CLUB_NAMES.get(club.lower(), club)


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


def winner_side_of(home_won: bool, away_won: bool) -> str:
    if home_won:
        return "home"
    if away_won:
        return "away"
    return ""


def parse_side(block: str) -> tuple[str, list, bool]:
    """Returns (team_name, [(player_id, name), ...], won)."""
    strong_team = STRONG_TEAM_RE.search(block)
    if strong_team:
        team_name = strong_team.group(1)
    else:
        team_name_match = TEAM_NAME_RE.search(block)
        team_name = team_name_match.group(1) if team_name_match else ""
    team_name = html.unescape(team_name)
    players = [(pid, html.unescape(name)) for pid, name in PLAYER_LINK_RE.findall(block)]
    won = bool(strong_team) or bool(STRONG_PLAYER_RE.search(block))
    return team_name, players, won


def parse_player_file(path: Path, tournament_id: str, player_id: str) -> PlayerPageInfo:
    html_text = path.read_text(encoding="utf-8", errors="replace")

    profile_match = PROFILE_RE.search(html_text)
    name = html.unescape(profile_match.group(1).strip()) if profile_match else path.stem
    guid = profile_match.group(2) if profile_match else None
    member_match = MEMBER_ID_RE.search(html_text)
    member_id = member_match.group(1) if member_match else None
    club_match = CLUB_RE.search(html_text)
    club = normalize_club(html.unescape(club_match.group(1))) if club_match else None

    info = PlayerPageInfo(
        tournament_id=tournament_id,
        player_id=player_id,
        name=name,
        profile_guid=guid,
        member_id=member_id,
        club=club,
    )

    overview_match = re.search(r"Match overview.*?<tbody>(.*?)</tbody>", html_text, re.DOTALL)
    if not overview_match:
        info.matches = parse_new_template_matches(html_text, tournament_id, player_id)
        return info
    overview_html = overview_match.group(1)

    for m in ROW_RE.finditer(overview_html):
        home_team, home_players, home_won = parse_side(m.group("home"))
        away_team, away_players, away_won = parse_side(m.group("away"))
        winner_side = winner_side_of(home_won, away_won)
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
