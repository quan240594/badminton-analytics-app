import fetch_events
from helpers_fetchers import (
    header_map,
    http_error,
    install_urlopen,
    patch_io,
    run_main,
    url_error,
    write_cookie,
    write_json,
)

TID = "T-1"


def events_file(tmp_path, pids):
    return write_json(tmp_path / "events.json", [{"tournament_id": TID, "player_id": pid} for pid in pids])


def run(monkeypatch, tmp_path, *extra):
    cookie = write_cookie(tmp_path)
    run_main(monkeypatch, fetch_events, str(tmp_path / "events.json"), "--cookie-file", str(cookie), "--out", str(tmp_path / "out"), *extra)


def test_fetch_sends_cookie_and_decodes(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/p": b"caf\xc3\xa9 \xff"})
    assert fetch_events.fetch("http://x/p", "c=1") == "café \ufffd"
    headers = header_map(fake.requests[0])
    assert headers["cookie"] == "c=1"
    assert headers["accept-language"] == "en-US,en;q=0.9"


def test_main_fetches_skips_and_counts_failures(monkeypatch, tmp_path, capsys):
    events_file(tmp_path, ["1", "2", "3", "4"])
    out = tmp_path / "out"
    out.mkdir()
    (out / f"{TID}_2.html").write_text("cached", encoding="utf-8")
    fake, sleeps = patch_io(monkeypatch, fetch_events, {"player=1": "p1", "player=3": http_error(404), "player=4": url_error("refused")})
    run(monkeypatch, tmp_path, "--delay", "0.2")
    captured = capsys.readouterr()
    assert (out / f"{TID}_1.html").read_text(encoding="utf-8") == "p1"
    assert not (out / f"{TID}_3.html").exists()
    assert "[3/4] FAILED" in captured.err and "HTTP 404" in captured.err
    assert "[4/4] FAILED" in captured.err and "refused" in captured.err
    assert "Fetched 1, failed 2, skipped (already existed) 1, total 4" in captured.out
    assert sleeps == [0.2]
    assert fake.urls[0] == f"https://badmintonnederland.toernooi.nl/sport/league/player?id={TID}&player=1"


def test_main_limit_and_progress_every_25_fetches(monkeypatch, tmp_path, capsys):
    events_file(tmp_path, [str(i) for i in range(30)])
    patch_io(monkeypatch, fetch_events, {"player=": "x"})
    run(monkeypatch, tmp_path, "--limit", "26")
    out = capsys.readouterr().out
    assert "[25/26] progress: 25 fetched, 0 failed, 0 skipped" in out
    assert "Fetched 26, failed 0, skipped (already existed) 0, total 26" in out
    assert len(list((tmp_path / "out").iterdir())) == 26
