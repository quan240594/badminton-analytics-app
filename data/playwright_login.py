#!/usr/bin/env python3
"""Log in to badmintonnederland.toernooi.nl with Playwright and save the resulting
session cookie in the same "name=value; name2=value2" format cookie.txt already uses.

Replaces get_cookie.py (which reads a local, already-logged-in browser's cookie jar)
for environments with no local browser profile, e.g. GitHub Actions. The site's
/user login page is client-rendered, so the plain urllib-based scrapers can't submit
it directly - a real browser is required for this one step only.

Requires: pip install playwright && playwright install --with-deps chromium

Usage:
    TOERNOOI_USERNAME=... TOERNOOI_PASSWORD=... python3 playwright_login.py --save cookie.txt
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

LOGIN_URL = "https://badmintonnederland.toernooi.nl/user?returnUrl=%2F"
DOMAIN = "badmintonnederland.toernooi.nl"


def login_and_get_cookie(username: str, password: str, headless: bool = True) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30_000)

        consent = page.locator("button.js-accept-basic")
        if consent.count():
            consent.first.click()
            page.wait_for_timeout(500)

        page.fill("#Login", username)
        page.fill("#Password", password)
        page.click("#btnLogin")
        page.wait_for_load_state("networkidle", timeout=30_000)

        if page.locator("#Password").count():
            browser.close()
            raise SystemExit("Login form still present after submit - check credentials or updated selectors.")

        cookies = context.cookies(urls=[LOGIN_URL])
        browser.close()

    if not cookies:
        raise SystemExit(f"No cookies captured for {DOMAIN} after login.")
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, default=Path("cookie.txt"))
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser (for local debugging)")
    args = parser.parse_args()

    username = os.environ.get("TOERNOOI_USERNAME")
    password = os.environ.get("TOERNOOI_PASSWORD")
    if not username or not password:
        print("TOERNOOI_USERNAME and TOERNOOI_PASSWORD must be set", file=sys.stderr)
        sys.exit(1)

    cookie = login_and_get_cookie(username, password, headless=not args.headed)
    args.save.write_text(cookie, encoding="utf-8")
    args.save.chmod(0o600)
    print(f"Wrote cookie ({len(cookie)} chars) to {args.save}")


if __name__ == "__main__":
    main()
