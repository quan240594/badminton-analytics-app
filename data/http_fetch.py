"""Shared urllib GET/POST helper and browser header sets for the scraper scripts."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from functools import partial

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"

# The site requires this full browser-like set (Sec-Fetch-*, Referer, sec-ch-ua) for some
# page types (e.g. player pages); a bare Cookie header gets bounced to the cookiewall.
CHROME_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": USER_AGENT,
    "sec-ch-ua": '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}

BASIC_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Toernooi.nl occasionally refuses a single connection transiently (seen live: one
# Connection-refused mid-run while everything around it succeeded) - a short retry absorbs
# that instead of failing the whole bounded CI run.
RETRY_DELAYS = (2, 5, 10)


def fetch_text(
    url: str,
    cookie: str,
    extra_headers: Mapping[str, str] | None = None,
    *,
    headers: Mapping[str, str],
    data: bytes | None = None,
    method: str | None = None,
    retry_delays: tuple[int, ...] = (),
) -> str:
    """GET (or POST when `data` is given) `url` with `headers` + the session cookie.

    Retries URLError/TimeoutError after each delay in `retry_delays`, then re-raises."""
    # Every caller builds `url` from its own hard-coded BASE_URL host constant; only the
    # path/query is CLI-influenced, so this can never redirect the request to another host.
    req = urllib.request.Request(url, data=data, headers={**headers, "Cookie": cookie, **(extra_headers or {})}, method=method)  # NOSONAR
    for attempt, delay in enumerate((*retry_delays, None)):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError):
            if delay is None:
                raise
            print(f"  fetch failed (attempt {attempt + 1}/{len(retry_delays) + 1}), retrying in {delay}s...", flush=True)
            time.sleep(delay)


fetch_chrome = partial(fetch_text, headers=CHROME_HEADERS)
fetch_basic = partial(fetch_text, headers=BASIC_HEADERS)
fetch_basic_retry = partial(fetch_text, headers=BASIC_HEADERS, retry_delays=RETRY_DELAYS)
