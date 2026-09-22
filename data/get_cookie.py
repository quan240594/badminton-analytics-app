#!/usr/bin/env python3
"""Read the current toernooi.nl session cookie directly from a local browser's
cookie store, instead of copy-pasting it from DevTools each time.

Requires: pip install browser-cookie3 (see .venv in this folder)
On macOS this will prompt for Keychain access the first time (to decrypt
Chrome's cookie store) - this is expected and safe; it only reads cookies for
the domain requested below, from your own already-logged-in browser session.

Usage:
    python3 get_cookie.py                       # print Cookie header to stdout
    python3 get_cookie.py --save cookie.txt      # write it to a file
    python3 get_cookie.py --browser firefox      # use Firefox instead of Chrome
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import browser_cookie3

DOMAIN = "badmintonnederland.toernooi.nl"

BROWSERS = {
    "chrome": browser_cookie3.chrome,
    "firefox": browser_cookie3.firefox,
    "safari": browser_cookie3.safari,
    "edge": browser_cookie3.edge,
    "brave": browser_cookie3.brave,
}


def build_cookie_header(browser: str, domain: str) -> str:
    loader = BROWSERS[browser]
    jar = loader(domain_name=domain)
    pairs = [f"{c.name}={c.value}" for c in jar]
    if not pairs:
        raise SystemExit(
            f"No cookies found for {domain} in {browser}. "
            "Make sure you're logged in and have visited the site recently in that browser."
        )
    return "; ".join(pairs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default="chrome", choices=sorted(BROWSERS))
    parser.add_argument("--domain", default=DOMAIN)
    parser.add_argument("--save", type=Path, help="Write the Cookie header to this file instead of stdout")
    args = parser.parse_args()

    try:
        cookie = build_cookie_header(args.browser, args.domain)
    except Exception as e:  # browser_cookie3 raises various backend-specific errors
        print(f"Failed to read cookies from {args.browser}: {e}", file=sys.stderr)
        sys.exit(1)

    if args.save:
        args.save.write_text(cookie, encoding="utf-8")
        args.save.chmod(0o600)
        print(f"Wrote cookie ({len(cookie)} chars) to {args.save}")
    else:
        print(cookie)


if __name__ == "__main__":
    main()
