#!/usr/bin/env python3
"""Fetch one tournament's events, draws and entries from
badmintonnederland.toernooi.nl (the same domain/session already used by the
league scraper - individual-tournament pages on www.toernooi.nl redirect here).

Unlike the league system, a single request per section is enough - no
per-match fan-out needed here; draw.aspx itself already renders full
standings + match scores (see fetch_tournament_draw.py for that).

Usage:
    python3 fetch_tournament_details.py <tournament_id> --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
import re
from html import unescape
from pathlib import Path

from http_fetch import BASIC_HEADERS, fetch_basic_retry, fetch_text
from safe_path import safe_path

# Individual-tournament pages on www.toernooi.nl redirect here - same domain
# and cookie/session as the existing league scraper, so this reuses that
# cookie.txt (from playwright_login.py), not the www.toernooi.nl-only
# tournament_cookie.txt used for discovery.
BASE_URL = "https://badmintonnederland.toernooi.nl/sport/"

EVENT_ROW_RE = re.compile(
    r'<td class="eventname nowrap "><a href="event\.aspx\?id=[^&]+&(?:amp;)?event=(\d+)">([^<]+)</a></td>'
    r'<td class="right">(\d+)</td><td class="right">(\d+)</td>'
)
DRAW_ROW_RE = re.compile(
    r'<td class="drawname "><a href="draw\.aspx\?id=[^&]+&(?:amp;)?draw=(\d+)" class="nowrap">([^<]+)</a></td>'
    r'<td>(\d*)</td><td>([^<]*)</td><td>([^<]*)</td><td>([^<]*)</td>'
)
# Split per-entry first - the country flag <img> is missing entirely for
# players without a recorded nationality, so it can't be a required anchor.
ENTRY_SPLIT_RE = re.compile(r'<li class="list__item js-alphabet-list-item"')
ENTRY_FLAG_RE = re.compile(r'flags/([A-Z]+)\.svg')
# One row of an event page's "Inschrijvingen" table = one entry: a single link
# for singles (or a doubles player still without a partner), two links for a pair.
EVENT_ROW_PLAYER_RE = re.compile(r'player\.aspx\?id=[^&"]+&(?:amp;)?player=(\d+)')
ENTRY_PLAYER_RE = re.compile(
    r'<a href="/sport/player\.aspx\?id=[^&]+&(?:amp;)?player=(\d+)" class="nav-link media__link">'
    r'<span class="nav-link__value">([^<]+)</span>'
)


fetch = fetch_basic_retry


# The entries list is loaded client-side (unlike events.aspx/draws.aspx, which
# are plain server-rendered tables) - players.aspx's initial HTML has no entry
# rows at all, they only appear after this XHR the page's own JS fires.
def fetch_entries_fragment(tournament_id: str, cookie: str) -> str:
    url = f"https://badmintonnederland.toernooi.nl/tournament/{tournament_id.lower()}/Players/GetPlayersContent"
    data = b"X-Requested-With=XMLHttpRequest"
    return fetch_text(
        url,
        cookie,
        {"Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest"},
        headers=BASIC_HEADERS,
        data=data,
        method="POST",
    )


def parse_events(html: str) -> list[dict]:
    return [
        {"event_id": eid, "name": unescape(name), "draws": int(draws), "entries": int(entries)}
        for eid, name, draws, entries in EVENT_ROW_RE.findall(html)
    ]


def parse_draws(html: str) -> list[dict]:
    return [
        {"draw_id": did, "name": unescape(name), "size": int(size) if size else None, "type": unescape(dtype), "stage": unescape(stage), "loser_round": unescape(loser_round) or None}
        for did, name, size, dtype, stage, loser_round in DRAW_ROW_RE.findall(html)
    ]


def parse_entries(html: str) -> list[dict]:
    entries = []
    for block in ENTRY_SPLIT_RE.split(html)[1:]:
        player_match = ENTRY_PLAYER_RE.search(block)
        if not player_match:
            continue
        flag_match = ENTRY_FLAG_RE.search(block)
        pid, name = player_match.groups()
        entries.append({"country": flag_match.group(1) if flag_match else None, "player_id": pid, "name": unescape(name)})
    return entries


def parse_event_participants(html: str) -> list[list[str]]:
    # The overall entry list says who is in the tournament, not who is in which
    # event - this per-event table does. Each entry is the list of its player
    # ids (two for a doubles pair), which join straight onto the entries' ids.
    _, _, after = html.partition("Inschrijvingen")
    table = after.split("</table>", 1)[0]
    participants = []
    for row in re.findall(r"<tr>(.*?)</tr>", table, re.DOTALL):
        ids = EVENT_ROW_PLAYER_RE.findall(row)
        if ids:
            participants.append(ids)
    return participants


def fetch_event_participants(tournament_id: str, event_id: str, cookie: str) -> list[list[str]]:
    return parse_event_participants(fetch(f"{BASE_URL}event.aspx?id={tournament_id}&event={event_id}", cookie))


def fetch_tournament_details(tournament_id: str, cookie: str) -> dict:
    events_html = fetch(f"{BASE_URL}events.aspx?id={tournament_id}", cookie)
    draws_html = fetch(f"{BASE_URL}draws.aspx?id={tournament_id}", cookie)
    entries_html = fetch_entries_fragment(tournament_id, cookie)
    events = parse_events(events_html)
    for event in events:
        # An event with no entries has no table to fetch.
        event["participants"] = fetch_event_participants(tournament_id, event["event_id"], cookie) if event["entries"] else []
    return {
        "events": events,
        "draws": parse_draws(draws_html),
        "entries": parse_entries(entries_html),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tournament_id")
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--out", type=Path, default=Path("tournament_details.json"))
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)
    args.out = safe_path(args.out)

    cookie = args.cookie_file.read_text(encoding="utf-8").strip()
    details = fetch_tournament_details(args.tournament_id, cookie)

    all_details = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else {}
    all_details[args.tournament_id.upper()] = details
    # path pre-validated by safe_path() against DATA_DIR (see safe_path.py)
    args.out.write_text(json.dumps(all_details, indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR

    print(
        f"Done. {len(details['events'])} events, {len(details['draws'])} draws, "
        f"{len(details['entries'])} entries for {args.tournament_id}"
    )


if __name__ == "__main__":
    main()
