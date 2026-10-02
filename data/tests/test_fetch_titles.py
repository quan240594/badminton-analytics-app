from types import SimpleNamespace

import pytest

import fetch_titles
from helpers_fetchers import (
    header_map,
    http_error,
    install_urlopen,
    no_sleep,
    read_json,
    run_main,
    write_cookie,
    write_json,
)


def title_entry(status, tournament, discipline):
    return (
        '<li class="list__item"><div class="flex-icon">'
        f'<i class="icon-event-winner-status--winner" title="{status}"></i></div>'
        f'<span class="nav-link__value">{tournament}</span>'
        f'<div class="text--muted"> <a href="#"><span class="nav-link__value">{discipline}</span></a></div></li>'
    )


def year_block(year, *entries):
    return f'<dt class="list__label list__label--loud">{year}</dt><dd class="list__value"><ul>{"".join(entries)}</ul></dd>'


@pytest.fixture
def env(monkeypatch, tmp_path):
    paths = SimpleNamespace(
        cookie=write_cookie(tmp_path),
        career=tmp_path / "career.json",
        titles=tmp_path / "titles.json",
        progress=tmp_path / "progress.json",
    )
    monkeypatch.setattr(fetch_titles, "COOKIE_FILE", paths.cookie)
    monkeypatch.setattr(fetch_titles, "CAREER_FILE", paths.career)
    monkeypatch.setattr(fetch_titles, "TITLES_FILE", paths.titles)
    monkeypatch.setattr(fetch_titles, "PROGRESS_FILE", paths.progress)
    paths.sleeps = no_sleep(monkeypatch)
    return paths


def test_load_cookie_strips_whitespace(env):
    assert fetch_titles.load_cookie() == "sess=abc"


def test_fetch_titles_for_player_parses_entries(monkeypatch):
    body = year_block(2025, title_entry("Winner", "Open &amp; Co", "HE A"), title_entry("Finalist", "Cup", "gd 1")) + year_block(
        2024, title_entry("Semi", "Old Cup", "Xx 2")
    )
    fake = install_urlopen(monkeypatch, {"/player-profile/GUID-1/PersonHome/TitlesFinals": body})
    assert fetch_titles.fetch_titles_for_player("GUID-1", "c=1") == [
        {"year": 2025, "status": "Winner", "tournament": "Open & Co", "discipline": "HE A", "category": "singles"},
        {"year": 2025, "status": "Finalist", "tournament": "Cup", "discipline": "gd 1", "category": "mixed"},
        {"year": 2024, "status": "Semi", "tournament": "Old Cup", "discipline": "Xx 2", "category": None},
    ]
    headers = header_map(fake.requests[0])
    assert headers["cookie"] == "c=1"
    assert headers["x-requested-with"] == "XMLHttpRequest"


def test_fetch_titles_for_player_without_blocks(monkeypatch):
    install_urlopen(monkeypatch, {"GUID": "<html></html>"})
    assert fetch_titles.fetch_titles_for_player("GUID", "c") == []


def test_write_progress(env):
    fetch_titles.write_progress(1, 4, True, "oops")
    assert read_json(env.progress) == {"done": 1, "total": 4, "running": True, "error": "oops"}


def test_main_resumes_records_failures_and_limits(monkeypatch, env, capsys):
    write_json(env.career, {"g1": {}, "g2": {}, "g3": {}, "g4": {}, "g5": {}})
    write_json(env.titles, {"g1": [{"year": 2020}]})
    install_urlopen(monkeypatch, {"g2": http_error(500), "g3": RuntimeError("bad"), "g4": year_block(2023, title_entry("Won", "T", "DD 1"))})
    run_main(monkeypatch, fetch_titles, "4")
    err = capsys.readouterr()
    saved = read_json(env.titles)
    assert saved["g2"] == [] and saved["g3"] == [] and saved["g4"][0]["category"] == "doubles" and "g5" not in saved
    assert "[2/4] g2 HTTP 500" in err.err
    assert "[3/4] g3 ERROR bad" in err.err
    assert "[4/4] saved" in err.err
    assert "done: 4 players" in err.out
    assert read_json(env.progress) == {"done": 4, "total": 4, "running": False, "error": None}
    assert len(env.sleeps) == 3


def test_main_saves_every_twenty_players(monkeypatch, env, capsys):
    write_json(env.career, {f"g{i}": {} for i in range(21)})
    install_urlopen(monkeypatch, {"g": "<html></html>"})
    run_main(monkeypatch, fetch_titles)
    err = capsys.readouterr().err
    assert "[20/21] saved" in err and "[21/21] saved" in err
    assert len(read_json(env.titles)) == 21
