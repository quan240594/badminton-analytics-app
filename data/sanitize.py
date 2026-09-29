"""Recursively sanitizes values before they're serialized to a JSON file we
persist to disk, so scraped/CLI-derived content can never smuggle dangerous
control characters (that data.isprintable() alone would wrongly treat \n/\t/
space as unsafe too - real scraped text legitimately contains those) or
unbounded strings into our own data files."""

from __future__ import annotations

MAX_STRING_LEN = 2000
# Printable + ordinary whitespace; excludes NUL and other control/escape bytes.
_ALLOWED_WHITESPACE = "\n\r\t "


def clean_json_value(value, max_len: int = MAX_STRING_LEN):
    if isinstance(value, str):
        cleaned = "".join(ch for ch in value if ch.isprintable() or ch in _ALLOWED_WHITESPACE)
        return cleaned[:max_len]
    if isinstance(value, dict):
        return {clean_json_value(k, max_len): clean_json_value(v, max_len) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_json_value(v, max_len) for v in value]
    return value
