from types import SimpleNamespace

import pytest

import scrape_all_draws as sad
from helpers_orchestrators import STAMP, exit_code, fake_clock, isolate_module, read_json, run_main, write_json

PATH_CONSTANTS = ("DETAILS_PATH", "MY_TOURNAMENTS_PATH", "FETCHED_DRAWS_PATH", "DRAWS_DATA_PATH")
DRAW = {"standings": [1, 2], "matches": [1]}
DETAILS = {
    "T1": {"draws": [{"draw_id": "10"}, {"draw_id": "9"}]},
    "T2": {"draws": [{"draw_id": "1"}]},
    "T3": {},
}


@pytest.fixture
def env(monkeypatch, tmp_path):
    paths = isolate_module(monkeypatch, sad, tmp_path, *PATH_CONSTANTS)
    cookie = tmp_path / "cookie.txt"
    cookie.write_text(" sess=1\n", encoding="utf-8")
    state = SimpleNamespace(paths=paths, cookie=cookie, fetches=[], error=None)

    def fake_fetch_draw(tournament_id, draw_id, cookie_text):
        state.fetches.append((tournament_id, draw_id, cookie_text))
        if state.error:
            raise state.error
        return DRAW

    monkeypatch.setattr(sad, "fetch_draw", fake_fetch_draw)
    return state


def args(env):
    return ["--cookie-file", str(env.cookie)]


def test_json_helpers_roundtrip(tmp_path):
    path = tmp_path / "x.json"
    assert sad.load_json(path, []) == []
    sad.save_json(path, {"naam": "Zoë"})
    assert sad.load_json(path, None) == {"naam": "Zoë"}


@pytest.mark.parametrize("mine,fetched,expected", [
    (set(), {}, [("T1", "9"), ("T1", "10"), ("T2", "1")]),
    ({"T2"}, {}, [("T2", "1"), ("T1", "9"), ("T1", "10")]),
    ({"T2"}, {"T1:9": {}, "T2:1": {}}, [("T1", "10")]),
])
def test_pending_work_orders_priority_then_tournament_then_numeric_draw(mine, fetched, expected):
    assert sad.pending_work(DETAILS, fetched, mine) == expected


def test_main_fetches_priority_draw_and_persists_results(env, monkeypatch, capsys):
    write_json(env.paths["DETAILS_PATH"], DETAILS)
    write_json(env.paths["MY_TOURNAMENTS_PATH"], ["T2"])
    write_json(env.paths["DRAWS_DATA_PATH"], {"T1": {"9": "existing"}})
    fake_clock(monkeypatch, sad, 0.0, 120.0)

    run_main(monkeypatch, sad, *args(env))

    assert env.fetches == [("T2", "1", "sess=1")]
    assert read_json(env.paths["DRAWS_DATA_PATH"]) == {"T1": {"9": "existing"}, "T2": {"1": DRAW}}
    assert read_json(env.paths["FETCHED_DRAWS_PATH"]) == {"T2:1": {"fetchedAt": STAMP}}
    out = capsys.readouterr().out
    assert "Draw 1 of tournament T2 (priority: your tournament)... [3 draws remaining]" in out
    assert "OK: 2 standings rows, 1 matches, took 2.0 min" in out
    assert "Run summary: 1 draws done overall (2 remaining)." in out


def test_main_without_my_tournaments_uses_plain_order(env, monkeypatch, capsys):
    write_json(env.paths["DETAILS_PATH"], DETAILS)
    fake_clock(monkeypatch, sad, 0.0, 1.0)
    run_main(monkeypatch, sad, *args(env))
    assert env.fetches[0][:2] == ("T1", "9")
    assert "(priority" not in capsys.readouterr().out


def test_main_exits_3_without_any_tournament_details(env, monkeypatch, capsys):
    assert exit_code(monkeypatch, sad, *args(env)) == sad.NOTHING_TO_DO
    assert "No tournament details fetched yet" in capsys.readouterr().out


def test_main_exits_3_when_every_draw_already_fetched(env, monkeypatch, capsys):
    write_json(env.paths["DETAILS_PATH"], DETAILS)
    write_json(env.paths["FETCHED_DRAWS_PATH"], {"T1:9": {}, "T1:10": {}, "T2:1": {}})
    assert exit_code(monkeypatch, sad, *args(env)) == sad.NOTHING_TO_DO
    assert "All known draws already fetched" in capsys.readouterr().out
    assert env.fetches == []


@pytest.mark.parametrize("error", [RuntimeError("boom"), OSError("down")])
def test_main_exits_1_and_persists_nothing_on_fetch_failure(env, monkeypatch, capsys, error):
    write_json(env.paths["DETAILS_PATH"], DETAILS)
    env.error = error
    fake_clock(monkeypatch, sad, 0.0, 1.0)
    assert exit_code(monkeypatch, sad, *args(env)) == 1
    assert "FAILED:" in capsys.readouterr().out
    assert not env.paths["DRAWS_DATA_PATH"].exists()
    assert not env.paths["FETCHED_DRAWS_PATH"].exists()
