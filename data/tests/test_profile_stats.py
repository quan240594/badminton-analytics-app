from helpers_parsers import profile_stats_module, stats_form_item, stats_item, stats_tab
from profile_stats import parse_profile_stats

FORM = (("25-9-2026", "success"), ("10-10-2026", "danger"))


def full_module() -> str:
    return profile_stats_module(
        stats_tab("Total", stats_item("Carri&#232;re", 97, 60), stats_item("Dit jaar", 77, 39), stats_form_item(FORM)),
        stats_tab("Singles", stats_item("Carri&#232;re", 45, 22), stats_item("Dit jaar", 34, 15)),
        stats_tab("Doubles", stats_item("Carri&#232;re", 32, 28), stats_item("Dit jaar", 26, 18)),
        stats_tab("Mixed", stats_item("Carri&#232;re", 20, 10), stats_item("Dit jaar", 17, 6)),
    )


def test_reads_career_this_year_and_form_for_every_discipline():
    stats = parse_profile_stats(full_module())
    assert stats["total"] == {
        "career": {"wins": 97, "losses": 60},
        "thisYear": {"wins": 77, "losses": 39},
        "form": [{"date": "2026-09-25", "won": True}, {"date": "2026-10-10", "won": False}],
    }
    assert stats["singles"] == {"career": {"wins": 45, "losses": 22}, "thisYear": {"wins": 34, "losses": 15}}
    assert stats["doubles"]["career"] == {"wins": 32, "losses": 28}
    assert stats["mixed"]["thisYear"] == {"wins": 17, "losses": 6}


def test_reads_english_labels():
    html = profile_stats_module(stats_tab("Total", stats_item("Career", 3, 1), stats_item("This year", 2, 0)))
    assert parse_profile_stats(html) == {"total": {"career": {"wins": 3, "losses": 1}, "thisYear": {"wins": 2, "losses": 0}}}


def test_a_discipline_without_matches_is_left_out():
    html = profile_stats_module(stats_tab("Total", stats_item("Carri&#232;re", 1, 1)), stats_tab("Mixed"))
    assert list(parse_profile_stats(html)) == ["total"]


def test_ignores_unknown_tabs_and_rows():
    html = profile_stats_module(stats_tab("Other", stats_item("Carri&#232;re", 1, 1)), stats_tab("Singles", stats_item("Punten", 5, 5)))
    assert parse_profile_stats(html) == {}


def test_a_page_without_the_statistics_module_has_none():
    assert parse_profile_stats("<html><body>Geen gegevens</body></html>") == {}


def test_stops_at_the_next_module():
    html = full_module() + stats_tab("Singles", stats_item("Carri&#232;re", 999, 999))
    assert parse_profile_stats(html)["singles"]["career"] == {"wins": 45, "losses": 22}
