import importlib

import pytest

import http_fetch
from helpers_fetchers import header_map, http_error, install_urlopen, no_sleep, url_error


def test_fetch_text_merges_headers_with_extra_overriding(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/x": "ok"})
    http_fetch.fetch_text("http://h/x", "c=1", {"Accept": "x/y"}, headers={"Accept": "a", "User-Agent": "UA"})
    req = fake.requests[0]
    assert header_map(req) == {"accept": "x/y", "user-agent": "UA", "cookie": "c=1"}
    assert req.get_method() == "GET" and req.data is None


def test_fetch_text_posts_body(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/x": "ok"})
    http_fetch.fetch_text("http://h/x", "c", headers={}, data=b"a=1", method="POST")
    assert fake.requests[0].get_method() == "POST" and fake.requests[0].data == b"a=1"


def test_fetch_text_replaces_undecodable_bytes(monkeypatch):
    install_urlopen(monkeypatch, {"/x": b"caf\xc3\xa9 \xff"})
    assert http_fetch.fetch_text("http://h/x", "c", headers={}) == "café \ufffd"


def test_fetch_text_does_not_retry_by_default(monkeypatch):
    sleeps = no_sleep(monkeypatch)
    fake = install_urlopen(monkeypatch, {"/x": [url_error("down")]})
    with pytest.raises(type(url_error())):
        http_fetch.fetch_text("http://h/x", "c", headers={})
    assert sleeps == [] and len(fake.requests) == 1


@pytest.mark.parametrize("error", [url_error("refused"), http_error(502), TimeoutError("slow")], ids=["url", "http", "timeout"])
def test_fetch_text_retries_transient_errors_then_succeeds(monkeypatch, capsys, error):
    sleeps = no_sleep(monkeypatch)
    install_urlopen(monkeypatch, {"/x": [error, error, "ok"]})
    assert http_fetch.fetch_text("http://h/x", "c", headers={}, retry_delays=(2, 5, 10)) == "ok"
    assert sleeps == [2, 5]
    assert "attempt 1/4), retrying in 2s" in capsys.readouterr().out


def test_fetch_text_gives_up_after_all_retries(monkeypatch):
    sleeps = no_sleep(monkeypatch)
    fake = install_urlopen(monkeypatch, {"/x": [url_error("down")]})
    with pytest.raises(type(url_error())):
        http_fetch.fetch_text("http://h/x", "c", headers={}, retry_delays=http_fetch.RETRY_DELAYS)
    assert sleeps == [2, 5, 10] and len(fake.requests) == 4


@pytest.mark.parametrize(
    "preset, header, value",
    [(http_fetch.fetch_chrome, "sec-fetch-dest", "document"), (http_fetch.fetch_basic, "accept", http_fetch.BASIC_HEADERS["Accept"])],
)
def test_presets_send_their_header_set_and_cookie(monkeypatch, preset, header, value):
    fake = install_urlopen(monkeypatch, {"/x": "ok"})
    preset("http://h/x", "c=1")
    headers = header_map(fake.requests[0])
    assert headers[header] == value and headers["cookie"] == "c=1" and headers["user-agent"] == http_fetch.USER_AGENT


def test_basic_retry_preset_retries(monkeypatch):
    sleeps = no_sleep(monkeypatch)
    install_urlopen(monkeypatch, {"/x": [url_error("blip"), "ok"]})
    assert http_fetch.fetch_basic_retry("http://h/x", "c") == "ok"
    assert sleeps == [2]


@pytest.mark.parametrize(
    "module_name, expected_attempts",
    [
        ("fetch_tournament_draw", 4),
        ("fetch_tournament_details", 4),
        ("fetch_events", 1),
        ("fetch_rankings", 1),
        ("fetch_tournament_rankings", 1),
        ("fetch_pages", 1),
    ],
)
def test_script_fetch_retry_policy(monkeypatch, module_name, expected_attempts):
    no_sleep(monkeypatch)
    fake = install_urlopen(monkeypatch, {"/x": [url_error("down")]})
    with pytest.raises(type(url_error())):
        importlib.import_module(module_name).fetch("http://h/x", "c")
    assert len(fake.requests) == expected_attempts
