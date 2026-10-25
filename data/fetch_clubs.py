#!/usr/bin/env python3
"""Fetch the national club list (name + id) and each club's city, for the
current Bondscompetitie season. Output: clubs.json ({clubId: {name, city}}).

Usage:
    python3 fetch_clubs.py --cookie-file cookie.txt
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
from pathlib import Path

from http_fetch import fetch_basic
from safe_path import safe_path
from sanitize import clean_json_value

from season import resolve_current_tournament_id

CURRENT_TOURNAMENT_ID = resolve_current_tournament_id("9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E")
BASE_URL = "https://badmintonnederland.toernooi.nl/sport/"


CLUB_LINK_RE = re.compile(r'<a[^>]{0,50}href="(club\.aspx\?[^"]+)"[^>]{0,50}>([^<]*)</a>')
CLUB_ID_RE = re.compile(r"club=(\d+)")
ADDRESS_RE = re.compile(r'<th>Address:</th>\s*<td[^>]*><table class="clean"><tr><td>([^<]+)</td>', re.S)


fetch = fetch_basic


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cookie-file", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--out", type=Path, default=Path("clubs.json"))
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    args.cookie_file = safe_path(args.cookie_file)
    args.out = safe_path(args.out)
    cookie = args.cookie_file.read_text(encoding="utf-8").strip()

    clubs_html = fetch(f"{BASE_URL}clubs.aspx?id={CURRENT_TOURNAMENT_ID}", cookie)
    entries = CLUB_LINK_RE.findall(clubs_html)
    print(f"found {len(entries)} clubs")

    existing: dict[str, dict] = {}
    if args.out.exists():
        existing = json.loads(args.out.read_text(encoding="utf-8"))

    for i, (href, name) in enumerate(entries, 1):
        club_id = CLUB_ID_RE.search(href).group(1)
        if club_id in existing and existing[club_id].get("city"):
            continue
        url = f"{BASE_URL}{href}"
        try:
            html = fetch(url, cookie)
        except urllib.error.URLError as ex:
            print(f"[{i}/{len(entries)}] FAILED club={club_id} ({name}) -> {ex}")
            continue
        m = ADDRESS_RE.search(html)
        city = m.group(1).strip() if m else None
        existing[club_id] = {"name": name.strip(), "city": city}
        if i % 20 == 0:
            print(f"[{i}/{len(entries)}] fetched club={club_id} {name.strip()} -> {city}")
            # path pre-validated by safe_path() against DATA_DIR (see safe_path.py)
            args.out.write_text(json.dumps(clean_json_value(existing), indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR
        time.sleep(args.delay)

    # path pre-validated by safe_path() against DATA_DIR (see safe_path.py)
    args.out.write_text(json.dumps(clean_json_value(existing), indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR
    print(f"done. wrote {len(existing)} clubs to {args.out}")


if __name__ == "__main__":
    main()
