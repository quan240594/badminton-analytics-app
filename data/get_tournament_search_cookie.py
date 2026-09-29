#!/usr/bin/env python3
"""Capture a www.toernooi.nl session cookie (cookie-consent accepted, sport
scoped to Badminton) for the plain-urllib tournament discovery scraper.

No login/credentials needed - tournament listings and entries are public;
this only needs to get past the GDPR consent wall and set the site-wide
sport filter, both of which are cookie-backed and reusable across requests.

Usage:
    python3 get_tournament_search_cookie.py --save tournament_cookie.txt
"""

from __future__ import annotations

import argparse
from pathlib import Path

from safe_path import safe_path

from playwright.sync_api import sync_playwright

TOURNAMENTS_URL = "https://www.toernooi.nl/tournaments"
BADMINTON_SPORT_ID = 2
SET_SPORT_URL = f"https://www.toernooi.nl/sportselection/setsportselection/{BADMINTON_SPORT_ID}?returnUrl=%2Ftournaments"


def capture_cookie(headless: bool = True) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context()
        page = context.new_page()
        page.goto(TOURNAMENTS_URL, wait_until="networkidle", timeout=30_000)
        page.wait_for_timeout(1200)

        # Two-layer consent: a basic in-page banner, then a nested nojazz.eu CMP
        # iframe with the real "accept all" control (a styled <div>, not a real
        # <button> - a plain button-role selector won't find it).
        basic = page.locator("button.js-accept-basic")
        if basic.count():
            basic.first.click()
            page.wait_for_timeout(1000)
        for frame in page.frames:
            if "nojazz" in frame.url:
                frame.locator("div.btn.green").click()
                break
        page.wait_for_timeout(1200)

        # Site-wide sport filter is session-scoped via this redirect, not a
        # per-request query param.
        page.goto(SET_SPORT_URL, wait_until="networkidle", timeout=30_000)
        page.wait_for_timeout(500)

        cookies = context.cookies(urls=[TOURNAMENTS_URL])
        browser.close()

    if not cookies:
        raise SystemExit("No cookies captured for www.toernooi.nl.")
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, default=Path("tournament_cookie.txt"))
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser (for local debugging)")
    args = parser.parse_args()
    args.save = safe_path(args.save)

    cookie = capture_cookie(headless=not args.headed)
    args.save.write_text(cookie, encoding="utf-8")
    print(f"Saved cookie ({len(cookie)} chars) to {args.save}")


if __name__ == "__main__":
    main()
