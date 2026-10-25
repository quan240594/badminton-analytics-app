#!/usr/bin/env python3
"""Capture a consent-only session cookie for badmintonnederland.toernooi.nl.

The national ranking lists are public; the site only wants the cookie banner accepted before
it serves them. No credentials are used or needed, which is why the national player crawl can
run on this cookie instead of the account's login session.

Usage:
    python3 get_ranking_cookie.py --save ranking_cookie.txt
"""

from __future__ import annotations

import argparse
import contextlib
from pathlib import Path

from safe_path import safe_path

from playwright.sync_api import sync_playwright

RANKING_URL = "https://badmintonnederland.toernooi.nl/ranking/"


def capture_cookie(headless: bool = True) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context()
        page = context.new_page()
        page.goto(RANKING_URL, wait_until="networkidle", timeout=40_000)
        page.wait_for_timeout(1200)

        # The basic in-page banner is enough here; the CMP iframe only appears for some sessions.
        basic = page.locator("button.js-accept-basic")
        if basic.count():
            basic.first.click()
        consent_button = page.frame_locator('iframe[title="Cookie preferences and consent management"]').locator("div.btn.green")
        with contextlib.suppress(Exception):
            consent_button.click(timeout=10_000)
        page.wait_for_timeout(1500)

        # Landing on the ranking page (not the cookie wall) proves the consent stuck.
        page.goto(RANKING_URL, wait_until="networkidle", timeout=40_000)
        cookies = context.cookies(urls=[RANKING_URL])
        browser.close()

    if not cookies:
        raise SystemExit("No cookies captured for badmintonnederland.toernooi.nl.")
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, default=Path("ranking_cookie.txt"))
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser (for local debugging)")
    args = parser.parse_args()
    args.save = safe_path(args.save)

    cookie = capture_cookie(headless=not args.headed)
    args.save.write_text(cookie, encoding="utf-8")
    print(f"Saved cookie ({len(cookie)} chars) to {args.save}")


if __name__ == "__main__":
    main()
