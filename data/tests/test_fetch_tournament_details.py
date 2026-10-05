import fetch_tournament_details as ftd
from helpers_fetchers import header_map, install_urlopen, patch_io, read_json, run_main, write_cookie, write_json

EVENTS_HTML = (
    '<td class="eventname nowrap "><a href="event.aspx?id=X&event=5">Heren Enkel</a></td><td class="right">3</td><td class="right">40</td>'
    '<td class="eventname nowrap "><a href="event.aspx?id=X&amp;event=6">Dames Dubbel</a></td><td class="right">1</td><td class="right">8</td>'
)
DRAWS_HTML = (
    '<td class="drawname "><a href="draw.aspx?id=X&draw=7" class="nowrap">HE A</a></td><td>32</td><td>Knockout</td><td>Main</td><td></td>'
    '<td class="drawname "><a href="draw.aspx?id=X&amp;draw=8" class="nowrap">DD B</a></td><td></td><td>Pool</td><td>Group</td><td>R2</td>'
)


def entry(pid, name, flag=None):
    img = f'<img src="/static/flags/{flag}.svg">' if flag else ""
    link = f'<a href="/sport/player.aspx?id=X&player={pid}" class="nav-link media__link"><span class="nav-link__value">{name}</span></a>'
    return f'<li class="list__item js-alphabet-list-item">{img}{link}</li>'


ENTRIES_HTML = "<ul>" + entry(1, "Jan", "NED") + entry(2, "Piet") + '<li class="list__item js-alphabet-list-item">no player</li>' + entry(3, "Kees", "GER")


def test_parse_events():
    assert ftd.parse_events(EVENTS_HTML) == [
        {"event_id": "5", "name": "Heren Enkel", "draws": 3, "entries": 40},
        {"event_id": "6", "name": "Dames Dubbel", "draws": 1, "entries": 8},
    ]


def test_parse_draws():
    assert ftd.parse_draws(DRAWS_HTML) == [
        {"draw_id": "7", "name": "HE A", "size": 32, "type": "Knockout", "stage": "Main", "loser_round": None},
        {"draw_id": "8", "name": "DD B", "size": None, "type": "Pool", "stage": "Group", "loser_round": "R2"},
    ]


def test_parse_entries_handles_missing_flag_and_player():
    assert ftd.parse_entries(ENTRIES_HTML) == [
        {"country": "NED", "player_id": "1", "name": "Jan"},
        {"country": None, "player_id": "2", "name": "Piet"},
        {"country": "GER", "player_id": "3", "name": "Kees"},
    ]


def test_parse_functions_on_empty_html():
    assert ftd.parse_events("") == [] and ftd.parse_draws("") == [] and ftd.parse_entries("") == []


def test_fetch_sends_cookie(monkeypatch):
    fake = install_urlopen(monkeypatch, {"/x": "body"})
    assert ftd.fetch("http://h/x", "c=1") == "body"
    assert header_map(fake.requests[0])["cookie"] == "c=1"


def test_fetch_entries_fragment_posts_form_xhr(monkeypatch):
    fake = install_urlopen(monkeypatch, {"GetPlayersContent": "frag"})
    assert ftd.fetch_entries_fragment("AB-CD", "c=1") == "frag"
    req = fake.requests[0]
    assert req.full_url == "https://badmintonnederland.toernooi.nl/tournament/ab-cd/Players/GetPlayersContent"
    assert req.get_method() == "POST" and req.data == b"X-Requested-With=XMLHttpRequest"
    headers = header_map(req)
    assert headers["cookie"] == "c=1"
    assert headers["content-type"] == "application/x-www-form-urlencoded"
    assert headers["x-requested-with"] == "XMLHttpRequest"


def test_fetch_tournament_details_combines_three_requests(monkeypatch):
    fake = install_urlopen(monkeypatch, {"events.aspx": EVENTS_HTML, "draws.aspx": DRAWS_HTML, "GetPlayersContent": ENTRIES_HTML})
    details = ftd.fetch_tournament_details("AB-CD", "c")
    assert [len(details[key]) for key in ("events", "draws", "entries")] == [2, 2, 3]
    assert fake.urls[0] == "https://badmintonnederland.toernooi.nl/sport/events.aspx?id=AB-CD"
    assert fake.urls[1].endswith("draws.aspx?id=AB-CD")


def test_main_merges_details_into_output(monkeypatch, tmp_path, capsys):
    patch_io(monkeypatch, ftd, {"events.aspx": EVENTS_HTML, "draws.aspx": DRAWS_HTML, "GetPlayersContent": ENTRIES_HTML})
    out = write_json(tmp_path / "details.json", {"OTHER": {"events": []}})
    run_main(monkeypatch, ftd, "ab-cd", "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out))
    saved = read_json(out)
    assert saved["OTHER"] == {"events": []}
    assert len(saved["AB-CD"]["entries"]) == 3
    assert "Done. 2 events, 2 draws, 3 entries for ab-cd" in capsys.readouterr().out


def test_main_creates_output_file(monkeypatch, tmp_path):
    patch_io(monkeypatch, ftd, {"events.aspx": "", "draws.aspx": "", "GetPlayersContent": ""})
    out = tmp_path / "new.json"
    run_main(monkeypatch, ftd, "T", "--cookie-file", str(write_cookie(tmp_path)), "--out", str(out))
    assert read_json(out) == {"T": {"events": [], "draws": [], "entries": []}}


def test_parsers_decode_html_entities():
    assert ftd.parse_events(EVENTS_HTML.replace("Heren Enkel", "ME&lt;11 &amp; Co"))[0]["name"] == "ME<11 & Co"
    assert ftd.parse_draws(DRAWS_HTML.replace("HE A", "D&#39;n A"))[0]["name"] == "D'n A"
    assert ftd.parse_entries(entry(9, "Bj&#246;rn Dulk&#233;e"))[0]["name"] == "Bj\u00f6rn Dulk\u00e9e"
