import json
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import pytest

import sync_supabase as ss
from helpers_orchestrators import exit_code, run_main

BASE = "https://abc.supabase.co"
KEY = "service-key"
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
STAMP = "2026-10-25T12:00:00Z"

STATE = {
    "players": {
        "100": {"name": "Noah Haase", "playerId": "p1", "ranks": {
            "75": {"week": "40-2026", "rankings": {"Mannen Enkel": {"rank": 1, "points": 17492, "matches": 28}, "Mannen Dubbel": {"rank": 46, "points": 6370, "matches": 20}}},
        }},
        "200": {"name": "Junior One", "playerId": None, "ranks": {
            "164": {"week": "40-2026", "rankings": {"Mannen Enkel": {"rank": 3, "points": 900, "matches": 9}}},
        }},
    },
}


class FakeResponse:
    def __init__(self, body=b"", headers=None):
        self.body, self.headers = body, headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


def http_error(code, body=b"nope"):
    return urllib.error.HTTPError(f"{BASE}/rest/v1/x", code, "msg", {}, __import__("io").BytesIO(body))


class FakeApi:
    """Stands in for urlopen: records every request and answers with the scripted outcomes (or 200 OK)."""

    def __init__(self, monkeypatch, outcomes=(), players_in_db=None):
        self.requests, self.outcomes, self.players_in_db = [], list(outcomes), players_in_db
        monkeypatch.setattr(ss.urllib.request, "urlopen", self)

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        if self.outcomes:
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        if req.get_method() == "GET":
            total = self.players_in_db if self.players_in_db is not None else 0
            return FakeResponse(b"[]", {"Content-Range": f"0-0/{total}"})
        return FakeResponse()

    def posts(self):
        return [(r.full_url, json.loads(r.data)) for r in self.requests if r.get_method() == "POST"]


def test_build_rows_makes_one_player_row_and_one_ranking_row_per_category():
    players, rankings = ss.build_rows(STATE, STAMP)

    assert players == [
        {"member_id": "100", "name": "Noah Haase", "site_player_id": "p1", "updated_at": STAMP},
        {"member_id": "200", "name": "Junior One", "site_player_id": None, "updated_at": STAMP},
    ]
    assert rankings == [
        {"member_id": "100", "list_id": "75", "week": "40-2026", "category": "Mannen Enkel", "rank": 1, "points": 17492, "matches": 28},
        {"member_id": "100", "list_id": "75", "week": "40-2026", "category": "Mannen Dubbel", "rank": 46, "points": 6370, "matches": 20},
        {"member_id": "200", "list_id": "164", "week": "40-2026", "category": "Mannen Enkel", "rank": 3, "points": 900, "matches": 9},
    ]


def test_build_rows_of_an_empty_state_is_empty():
    assert ss.build_rows({}, STAMP) == ([], [])


def test_chunks_splits_into_batches_of_the_given_size():
    assert [len(c) for c in ss.chunks(list(range(7)), 3)] == [3, 3, 1]
    assert list(ss.chunks([], 3)) == []


def test_request_sends_the_key_and_returns_headers_and_body(monkeypatch):
    api = FakeApi(monkeypatch, [FakeResponse(b"ok", {"X": "1"})])

    headers, body = ss.request(f"{BASE}/rest/v1/players", KEY, data=b"[]", headers={"Prefer": "x"})

    assert (headers["X"], body) == ("1", b"ok")
    sent = api.requests[0]
    assert sent.get_header("Apikey") == KEY and sent.get_header("Authorization") == f"Bearer {KEY}"
    assert sent.get_header("Prefer") == "x" and sent.get_method() == "POST"


@pytest.mark.parametrize("code", [400, 401, 403, 404, 409])
def test_request_fails_at_once_on_a_client_error_without_retrying(monkeypatch, code):
    api = FakeApi(monkeypatch, [http_error(code, b"bad row")])
    slept = []

    with pytest.raises(ss.SyncError, match=f"HTTP {code}.*bad row"):
        ss.request(f"{BASE}/rest/v1/players", KEY, sleep=slept.append)

    assert len(api.requests) == 1 and slept == []


def test_request_retries_server_errors_and_network_errors_with_growing_pauses(monkeypatch):
    slept = []
    FakeApi(monkeypatch, [http_error(503), urllib.error.URLError("reset"), FakeResponse(b"fine")])

    assert ss.request(f"{BASE}/rest/v1/players", KEY, sleep=slept.append)[1] == b"fine"
    assert slept == [5, 15]


def test_request_gives_up_after_the_last_retry(monkeypatch):
    slept = []
    FakeApi(monkeypatch, [TimeoutError("slow")] * 3)

    with pytest.raises(ss.SyncError, match="slow"):
        ss.request(f"{BASE}/rest/v1/players", KEY, sleep=slept.append)
    assert slept == [5, 15]


def test_upsert_posts_batches_that_merge_on_the_conflict_key(monkeypatch):
    api = FakeApi(monkeypatch)
    rows = [{"member_id": str(i)} for i in range(ss.BATCH_SIZE + 1)]

    ss.upsert(BASE, KEY, "players", "member_id", rows)

    posts = api.posts()
    assert [len(batch) for _, batch in posts] == [ss.BATCH_SIZE, 1]
    assert posts[0][0] == f"{BASE}/rest/v1/players?on_conflict=member_id"
    assert api.requests[0].get_header("Prefer") == "resolution=merge-duplicates,return=minimal"


def test_count_rows_reads_the_total_from_content_range(monkeypatch):
    api = FakeApi(monkeypatch, [FakeResponse(b"[]", {"Content-Range": "0-0/8004"})])

    assert ss.count_rows(BASE, KEY, "players") == 8004
    assert api.requests[0].get_header("Prefer") == "count=exact"


def test_sync_upserts_players_before_the_rankings_that_reference_them(monkeypatch):
    api = FakeApi(monkeypatch, players_in_db=2)

    result = ss.sync(STATE, BASE, KEY, now=NOW)

    assert result == {"players": 2, "rankings": 3, "players_in_db": 2}
    urls = [url for url, _ in api.posts()]
    assert urls == [f"{BASE}/rest/v1/players?on_conflict=member_id", f"{BASE}/rest/v1/national_rankings?on_conflict={ss.RANKINGS_CONFLICT}"]
    assert api.posts()[0][1][0]["updated_at"] == STAMP


def test_sync_fails_when_the_database_holds_fewer_players_than_were_synced(monkeypatch):
    FakeApi(monkeypatch, players_in_db=1)

    with pytest.raises(ss.SyncError, match="only 1 players in the database after syncing 2"):
        ss.sync(STATE, BASE, KEY, now=NOW)


@pytest.mark.parametrize("value", [None, "", "http://abc.supabase.co", "https://example.com", "https://supabase.co.evil.test", "not a url"])
def test_project_url_rejects_anything_but_an_https_supabase_project(value):
    with pytest.raises(SystemExit, match="SUPABASE_URL"):
        ss.project_url(value)


def test_project_url_keeps_only_the_host():
    assert ss.project_url("https://abc.supabase.co/rest/v1/?x=1") == BASE


@pytest.fixture
def state_file(monkeypatch, tmp_path):
    path = tmp_path / "state.json"
    path.write_text(json.dumps(STATE), encoding="utf-8")
    monkeypatch.setattr(ss, "safe_path", lambda p: Path(p))
    monkeypatch.setenv("SUPABASE_URL", BASE)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", KEY)
    return path


def test_main_syncs_and_reports_the_counts(monkeypatch, state_file, capsys):
    FakeApi(monkeypatch, players_in_db=2)

    run_main(monkeypatch, ss, "--state", str(state_file))

    assert "Synced 2 players and 3 ranking rows; 2 players now in the database." in capsys.readouterr().out


def test_main_requires_the_service_role_key(monkeypatch, state_file):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    with pytest.raises(SystemExit, match="SUPABASE_SERVICE_ROLE_KEY"):
        run_main(monkeypatch, ss, "--state", str(state_file))


def test_main_exits_with_an_error_annotation_when_the_sync_fails(monkeypatch, state_file, capsys):
    FakeApi(monkeypatch, [http_error(401, b"bad key")])

    assert exit_code(monkeypatch, ss, "--state", str(state_file)) == 1
    assert "::error::Supabase sync failed" in capsys.readouterr().err
