#!/usr/bin/env python3
"""Log in to www.toernooi.nl (same account/credentials as the league scraper's
playwright_login.py, just a different subdomain - this platform appears to
share one account across all federation sites) and scrape the "Mijn
toernooien" card on the /tournaments homepage: tournaments the account has
registered in or starred as a favorite. Writes their ids to my_tournaments.json
so scrape_all_draws.py can fetch those tournaments' draws first.

NOTE: could not be validated end-to-end without real TOERNOOI_USERNAME/
TOERNOOI_PASSWORD credentials during development (only public/anonymous
reconnaissance was possible) - the card is empty for a logged-out session, so
its populated markup is inferred, not confirmed. Logs clearly and exits
0 with an empty list rather than failing the whole workflow if the card isn't
found where expected; check a real run's logs and adjust the selectors below
if so.

Usage:
    TOERNOOI_USERNAME=... TOERNOOI_PASSWORD=... python3 get_my_tournaments.py --save my_tournaments.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from safe_path import safe_path

from playwright.sync_api import sync_playwright

LOGIN_URL = "https://www.toernooi.nl/user?returnUrl=%2Ftournaments"
ID_RE = re.compile(r'tournament\?id=([0-9A-Fa-f-]+)')


def fetch_my_tournament_ids(username: str, password: str, headless: bool = True) -> list[str]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30_000)

        basic = page.locator("button.js-accept-basic")
        if basic.count():
            basic.first.click()
        # frame_locator auto-waits for the iframe itself to attach *and* for
        # the button inside it to become actionable - a plain `for frame in
        # page.frames` snapshot can run before the iframe (injected by a
        # third-party CMP script) has attached yet, silently leaving the
        # overlay in place to block every click after it (seen for real in a
        # CI run: the login button click timed out 30s later, still blocked).
        consent_button = page.frame_locator(
            'iframe[title="Cookie preferences and consent management"]'
        ).locator("div.btn.green")
        try:
            consent_button.click(timeout=10_000)
        except Exception:
            pass  # consent already accepted / no CMP iframe shown this time

        page.fill("#Login", username)
        page.fill("#Password", password)
        page.click("#btnLogin")
        page.wait_for_load_state("networkidle", timeout=30_000)

        if page.locator("#Password").count():
            browser.close()
            raise SystemExit("Login form still present after submit - check credentials or updated selectors.")

        page.goto("https://www.toernooi.nl/tournaments", wait_until="networkidle", timeout=30_000)
        page.wait_for_timeout(1500)

        html = page.content()
        browser.close()

    # Scope to the "Mijn toernooien" card specifically, not the whole page (a
    # search results section elsewhere would also contain tournament?id= links).
    marker = html.find("Mijn toernooien")
    if marker == -1:
        print("WARNING: 'Mijn toernooien' card not found on the page - selectors may be stale.", file=sys.stderr)
        return []
    card_html = html[marker : marker + 20_000]  # generous bound past the card's own content
    return sorted({m.upper() for m in ID_RE.findall(card_html)})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, default=Path("my_tournaments.json"))
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser (for local debugging)")
    args = parser.parse_args()
    args.save = safe_path(args.save)

    username = os.environ.get("TOERNOOI_USERNAME")
    password = os.environ.get("TOERNOOI_PASSWORD")
    if not username or not password:
        print("TOERNOOI_USERNAME and TOERNOOI_PASSWORD must be set", file=sys.stderr)
        sys.exit(1)

    tournament_ids = fetch_my_tournament_ids(username, password, headless=not args.headed)
    args.save.write_text(json.dumps(tournament_ids, indent=2), encoding="utf-8")
    print(f"Found {len(tournament_ids)} registered/favorited tournament(s), saved to {args.save}")


if __name__ == "__main__":
    main()
