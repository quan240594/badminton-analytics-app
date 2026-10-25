"""Parse the "Statistieken" module of a toernooi.nl player-profile page.

The module has one tab per discipline (total / singles / doubles / mixed), each
with the career and this-year win-loss records; the total tab also lists the
result of the last few matches. Result: {discipline: {"career": {"wins", "losses"},
"thisYear": {...}, "form": [{"date", "won"}, ...]}} - empty when the page has no
statistics module.
"""

from __future__ import annotations

import re
from html import unescape

SECTION_START = 'id="playerStatsTabs"'
SECTION_END = "module__title-main"
TAB_MARKER = '<div id="tabStats'
ITEM_MARKER = '<div class="list__item">'
TAB_DISCIPLINES = {"Total": "total", "Singles": "singles", "Doubles": "doubles", "Mixed": "mixed"}
LABEL_RE = re.compile(r'list__label">([^<]{1,40})<')
RECORD_RE = re.compile(r'list__value-start">\s{0,40}(\d{1,5}) / (\d{1,5}) \(\d{1,5}\)')
# W/V (win/loss) tags are told apart by class, which the page's language does not change.
FORM_RE = re.compile(r'tag--(success|danger) tag match__status" title="(\d{1,2})-(\d{1,2})-(\d{4})"')


def record_period(label: str) -> str | None:
    name = unescape(label).strip().lower()
    if name.startswith(("carri", "career")):
        return "career"
    if name in ("dit jaar", "this year"):
        return "thisYear"
    return None


def parse_tab(tab: str) -> dict:
    stats: dict = {}
    for item in tab.split(ITEM_MARKER)[1:]:
        label = LABEL_RE.search(item)
        record = RECORD_RE.search(item)
        period = record_period(label.group(1)) if label and record else None
        if period and record:
            stats[period] = {"wins": int(record.group(1)), "losses": int(record.group(2))}
        form = [
            {"date": f"{year}-{int(month):02d}-{int(day):02d}", "won": outcome == "success"}
            for outcome, day, month, year in FORM_RE.findall(item)
        ]
        if form:
            stats["form"] = form
    return stats


def parse_profile_stats(html: str) -> dict[str, dict]:
    start = html.find(SECTION_START)
    if start < 0:
        return {}
    end = html.find(SECTION_END, start)
    section = html[start : end if end > 0 else len(html)]
    result: dict[str, dict] = {}
    for tab in section.split(TAB_MARKER)[1:]:
        discipline = TAB_DISCIPLINES.get(tab.split('"', 1)[0])
        stats = parse_tab(tab)
        if discipline and stats:
            result[discipline] = stats
    return result
