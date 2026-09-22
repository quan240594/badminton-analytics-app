#!/usr/bin/env python3
"""Extract and categorize all links from a toernooi.nl (tournamentsoftware) saved HTML page.

Usage:
    python3 scrape_links.py badminton.html
    python3 scrape_links.py badminton.html --category team
    python3 scrape_links.py badminton.html --json links.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Maps a substring found in the href path to a human-readable category name.
CATEGORY_PATTERNS: list[tuple[str, str]] = [
    ("teammatch.aspx", "match"),
    ("team.aspx", "team"),
    ("location.aspx", "location"),
    ("playerstats.aspx", "player_stats"),
    ("drawstats.aspx", "draw_stats"),
    ("drawmatches.aspx", "draw_matches"),
    ("drawsheet.aspx", "draw_sheet"),
    ("draw.aspx", "draw_general"),
    ("player-profile", "player_profile"),
    ("teams.aspx", "teams_overview"),
]


class LinkExtractor(HTMLParser):
    """Collects (href, link_text) pairs from <a> tags."""

    def __init__(self) -> None:
        super().__init__()
        self._current_href: str | None = None
        self._current_text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self._current_href = href
            self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._current_href is not None:
            text = "".join(self._current_text).strip()
            text = re.sub(r"\s+", " ", text)
            self.links.append((self._current_href, text))
            self._current_href = None
            self._current_text = []


def categorize(href: str) -> str:
    for needle, category in CATEGORY_PATTERNS:
        if needle in href:
            return category
    if href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
        return "misc"
    if any(href.lower().endswith(ext) for ext in (".css", ".js", ".svg", ".png", ".gif", ".jpg", ".ico", ".json")):
        return "asset"
    return "other"


def query_params(href: str) -> dict[str, str]:
    parsed = urlparse(href)
    return {k: v[0] for k, v in parse_qs(parsed.query).items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html_file", type=Path, help="Path to the saved HTML file")
    parser.add_argument("--category", help="Only show links in this category")
    parser.add_argument("--json", type=Path, help="Write full results as JSON to this path")
    parser.add_argument("--unique", action="store_true", help="Deduplicate by href")
    args = parser.parse_args()

    html = args.html_file.read_text(encoding="utf-8", errors="replace")

    extractor = LinkExtractor()
    extractor.feed(html)

    grouped: dict[str, list[dict]] = defaultdict(list)
    seen: set[str] = set()
    for href, text in extractor.links:
        if args.unique:
            if href in seen:
                continue
            seen.add(href)
        category = categorize(href)
        grouped[category].append({
            "href": href,
            "text": text,
            "params": query_params(href),
        })

    if args.json:
        args.json.write_text(json.dumps(grouped, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {sum(len(v) for v in grouped.values())} links to {args.json}")

    categories = [args.category] if args.category else sorted(grouped.keys())
    for category in categories:
        items = grouped.get(category, [])
        if not items:
            continue
        print(f"\n=== {category} ({len(items)}) ===")
        for item in items:
            label = item["text"] or "(no text)"
            print(f"  {label!r:50s} -> {item['href']}")


if __name__ == "__main__":
    main()
