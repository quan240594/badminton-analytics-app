import json
from datetime import date

import pytest

import season


@pytest.mark.parametrize(
    "today,label",
    [
        (date(2026, 9, 1), "2026-2027"),
        (date(2026, 12, 31), "2026-2027"),
        (date(2027, 1, 15), "2026-2027"),
        (date(2026, 8, 31), "2025-2026"),
    ],
)
def test_current_season_label_for_date(today, label):
    assert season.current_season_label(today) == label


def test_current_season_label_defaults_to_today(monkeypatch):
    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 2)

    monkeypatch.setattr(season, "date", FixedDate)

    assert season.current_season_label() == "2026-2027"


@pytest.fixture
def events_index(tmp_path, monkeypatch):
    path = tmp_path / "events_index.json"
    monkeypatch.setattr(season, "EVENTS_INDEX_PATH", path)
    return path


def write_events(path, *events):
    path.write_text(json.dumps(list(events)), encoding="utf-8")


def event(name, tid):
    return {"event_name": name, "tournament_id": tid}


def test_resolve_returns_default_when_index_is_missing(events_index):
    assert season.resolve_current_tournament_id("DEFAULT", "2026-2027") == "DEFAULT"


def test_resolve_returns_the_unique_matching_id(events_index):
    write_events(
        events_index,
        event("Bondscompetitie 2026-2027", "NEW"),
        event("Bondscompetitie 2026-2027", "NEW"),
        event("Bondscompetitie 2025-2026", "OLD"),
        {"tournament_id": "NAMELESS"},
    )

    assert season.resolve_current_tournament_id("DEFAULT", "2026-2027") == "NEW"


def test_resolve_warns_and_uses_default_for_ambiguous_ids(events_index, capsys):
    write_events(events_index, event("Bondscompetitie 2026-2027", "A"), event("Bondscompetitie 2026-2027", "B"))

    assert season.resolve_current_tournament_id("DEFAULT", "2026-2027") == "DEFAULT"
    assert "multiple tournament ids" in capsys.readouterr().err


def test_resolve_warns_and_uses_default_when_season_absent(events_index, monkeypatch, capsys):
    write_events(events_index, event("Bondscompetitie 2025-2026", "OLD"))
    monkeypatch.setattr(season, "current_season_label", lambda: "2026-2027")

    assert season.resolve_current_tournament_id("DEFAULT") == "DEFAULT"
    err = capsys.readouterr().err
    assert "no 'Bondscompetitie 2026-2027' entry" in err
    assert "DEFAULT" in err
