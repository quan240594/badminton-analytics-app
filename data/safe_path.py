"""Path-traversal guard shared by every scraper/CLI script in this package.

Every script here only ever needs to read/write within its own directory
(`data/`), even though the actual paths come from argparse `--out`/
`--cookie-file`/etc. flags. Resolving those against this directory and
rejecting anything that escapes it closes off traversal regardless of how
the argument was built (relative segments, symlinks, absolute overrides).
"""

from __future__ import annotations

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent


def safe_path(path: Path | str, base: Path = DATA_DIR) -> Path:
    candidate = Path(path)
    resolved = candidate.resolve() if candidate.is_absolute() else (base / candidate).resolve()
    base_resolved = base.resolve()
    if resolved != base_resolved and base_resolved not in resolved.parents:
        raise ValueError(f"refusing to access path outside {base_resolved}: {resolved}")
    return resolved
