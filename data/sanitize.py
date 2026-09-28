"""Recursively sanitizes values before they're serialized to a JSON file we
persist to disk, so scraped/CLI-derived content can never smuggle control
characters or unbounded strings into our own data files."""

from __future__ import annotations

MAX_STRING_LEN = 500


def clean_json_value(value, max_len: int = MAX_STRING_LEN):
    if isinstance(value, str):
        return "".join(ch for ch in value if ch.isprintable())[:max_len]
    if isinstance(value, dict):
        return {clean_json_value(k, max_len): clean_json_value(v, max_len) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_json_value(v, max_len) for v in value]
    return value
