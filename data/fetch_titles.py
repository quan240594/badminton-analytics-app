#!/usr/bin/env python3
"""Fetch the "Titles/Finals" module from each player's public player-profile page
and store the most recent tournament placement per discipline (singles/doubles/mixed)
into data/titles.json.

The per-tournament league "Match overview" (player.aspx) has no title/placement data;
individual tournament results only appear on the player-profile page's Titles/Finals
widget, which is why this needs its own fetch pass keyed by profile GUID.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).parent
COOKIE_FILE = DATA_DIR / "cookie.txt"
CAREER_FILE = DATA_DIR / "career.json"
TITLES_FILE = DATA_DIR / "titles.json"
PROGRESS_FILE = DATA_DIR / "titles_progress.json"

# Dutch discipline abbreviations: HE/ME = Heren/Mannen Enkel (men's singles),
# DE/VE = Dames/Vrouwen Enkel (women's singles); HD/MD = Heren/Mannen Dubbel (men's doubles),
# DD/VD = Dames/Vrouwen Dubbel (women's doubles); GD = Gemengd Dubbel (mixed doubles).
DISCIPLINE_MAP = {
    "HE": "singles", "ME": "singles", "DE": "singles", "VE": "singles",
    "HD": "doubles", "MD": "doubles", "DD": "doubles", "VD": "doubles",
    "GD": "mixed",
}

YEAR_BLOCK_RE = re.compile(
    r'<dt class="list__label list__label--loud">(?P<year>\d{4})</dt>\s*'
    r'<dd class="list__value">(?P<body>.*?)</dd>',
    re.DOTALL,
)
ENTRY_RE = re.compile(
    r'<li class="list__item">\s*<div class="flex-icon">.*?'
    r'icon-event-winner-status--(?P<status_code>[\w-]+)"[^>]*title="(?P<status>[^"]+)".*?'
    r'<span class="nav-link__value">(?P<tournament>[^<]+)</span>.*?'
    r'<div class="text--muted">\s*<a[^>]*><span class="nav-link__value">(?P<discipline>[^<]+)</span>',
    re.DOTALL,
)


def load_cookie() -> str:
    return COOKIE_FILE.read_text(encoding="utf-8").strip()


def fetch_titles_for_player(guid: str, cookie: str) -> list[dict]:
    # The profile page's inline "Titles/Finals" widget only ever shows a handful of
    # recent entries; the full history only loads via this async-modal endpoint
    # (found via the widget's "All" link, class="nav-link js-asyncmodal").
    url = f"https://badmintonnederland.toernooi.nl/player-profile/{guid}/PersonHome/TitlesFinals"
    req = urllib.request.Request(
        url, headers={"Cookie": cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        module_html = resp.read().decode("utf-8", errors="replace")

    entries = []
    for year_match in YEAR_BLOCK_RE.finditer(module_html):
        year = int(year_match.group("year"))
        for m in ENTRY_RE.finditer(year_match.group("body")):
            discipline_code = m.group("discipline").strip()
            prefix = discipline_code[:2].upper()
            category = DISCIPLINE_MAP.get(prefix)
            entries.append({
                "year": year,
                "status": m.group("status"),
                "tournament": m.group("tournament").strip(),
                "discipline": discipline_code,
                "category": category,
            })
    return entries


def write_progress(done: int, total: int, running: bool, error: str | None = None) -> None:
    PROGRESS_FILE.write_text(json.dumps({
        "done": done, "total": total, "running": running, "error": error,
    }), encoding="utf-8")


def main() -> None:
    cookie = load_cookie()
    career = json.loads(CAREER_FILE.read_text(encoding="utf-8"))
    guids = list(career.keys())

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(guids)
    guids = guids[:limit]

    titles: dict[str, list[dict]] = {}
    if TITLES_FILE.exists():
        titles = json.loads(TITLES_FILE.read_text(encoding="utf-8"))

    total = len(guids)
    write_progress(0, total, True)
    for i, guid in enumerate(guids):
        if guid in titles:
            continue
        try:
            titles[guid] = fetch_titles_for_player(guid, cookie)
        except urllib.error.HTTPError as e:
            titles[guid] = []
            print(f"[{i+1}/{total}] {guid} HTTP {e.code}", file=sys.stderr)
        except Exception as e:
            titles[guid] = []
            print(f"[{i+1}/{total}] {guid} ERROR {e}", file=sys.stderr)

        if (i + 1) % 20 == 0 or i + 1 == total:
            TITLES_FILE.write_text(json.dumps(titles, ensure_ascii=False, indent=2), encoding="utf-8")
            write_progress(i + 1, total, True)
            print(f"[{i+1}/{total}] saved", file=sys.stderr)
        time.sleep(0.3)

    TITLES_FILE.write_text(json.dumps(titles, ensure_ascii=False, indent=2), encoding="utf-8")
    write_progress(total, total, False)
    print(f"done: {len(titles)} players")


if __name__ == "__main__":
    main()
