"""Inline HTML builders that mimic the toernooi.nl pages the parsers consume."""

from __future__ import annotations


def player_link(pid: str, name: str, tid: str = "T1") -> str:
    return f'<a href="player.aspx?id={tid}&player={pid}">{name}</a>'


def strong(inner: str) -> str:
    return f"<strong>{inner}</strong>"


def team_link(name: str) -> str:
    return f'<a class="teamname" href="team.aspx?id=T1&team=1">{name}</a>'


def real_team_link(name: str, match: int = 8612) -> str:
    """A team link as the site really renders it: the href follows the class and is ~80 chars long."""
    href = f"../teammatch.aspx?id=9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E&match={match}"
    return f'<a class="teamname" href="{href}">{name}</a>'


def classic_side(team: str = "", players: tuple = (), winner: str | None = None) -> str:
    """One side of a classic match row; winner is None, "team" or "player"."""
    team_html = team_link(team) if team else ""
    if winner == "team":
        team_html = strong(team_html)
    links = [player_link(pid, name) for pid, name in players]
    if winner == "player":
        links = [strong(link) for link in links]
    return team_html + " ".join(links)


def classic_row(home: str, away: str, time: str = "Mon 01-09-2025", event: str = "MS", draw: str = "Afd 1A", score: str = "21-15 21-10") -> str:
    return (
        f'<tr><td align="right">{time}</td><td>{event}</td><td>{draw}</td>'
        f'<td class="nowrap" align="right">{home}</td><td align="center">-</td>'
        f'<td class="nowrap">{away}</td><td><span class="score">{score}</span></td></tr>'
    )


def classic_player_page(
    name: str | None = "Jan Jansen",
    guid: str = "AB12-cd34",
    member_id: str | None = "1234567",
    club: str | None = "BBS",
    rows: tuple = (),
    overview: bool = True,
    extra: str = "",
) -> str:
    parts = ["<html><body>"]
    if name is not None:
        parts.append(f'<h2>{name}<a href="/player-profile/{guid}" class="x">Profile</a></h2>')
    if member_id is not None:
        parts.append(f"<table><tr><th>Member ID:</th><td>{member_id}</td></tr>")
        parts.append("</table>")
    if club is not None:
        parts.append(f'<table><tr><th>Club:</th><td><a href="club.aspx">{club}</a></td></tr></table>')
    if overview:
        parts.append(f"<h3>Match overview</h3><table><thead></thead><tbody>{''.join(rows)}</tbody></table>")
    parts.append(extra)
    parts.append("</body></html>")
    return "".join(parts)


def new_template_player(pid: str, name: str) -> str:
    return f'<a href="#" data-player-id="{pid}" class="x"><span class="nav-link__value">{name}</span></a>'


def new_template_item(
    home: tuple = (),
    away: tuple = (),
    home_won: bool = False,
    away_won: bool = False,
    draw: str | None = "MS A",
    time: str | None = "Mon 01/09/2025 20:00",
    sets: tuple = ((21, 15), (21, 10)),
    extra_ul: str = "",
) -> str:
    """One <li class="match-group__item"> card of the redesigned tournament template."""
    draw_html = f'<a href="draw.aspx?id=T&amp;draw=5" class="nav-link"><span class="nav-link__value">{draw}</span></a>' if draw else ""
    time_html = f'<span class="nav-link__value">{time}</span>' if time else ""
    home_cls = " has-won" if home_won else ""
    away_cls = " has-won" if away_won else ""
    home_html = "".join(new_template_player(pid, name) for pid, name in home)
    away_html = "".join(new_template_player(pid, name) for pid, name in away)
    points = "".join(
        f'<ul class="points"><li class="points__cell">{a}</li><li class="points__cell has-won">{b}</li></ul>' for a, b in sets
    )
    return (
        f'<li class="match-group__item">{draw_html}{time_html}'
        f'<div class="match__row{home_cls}">{home_html}</div>'
        f'<div class="match__row{away_cls}">{away_html}</div>{points}{extra_ul}</li>'
    )


def stats_item(label: str, wins: int, losses: int) -> str:
    """One win-loss row of a profile's Statistieken tab, with the progress bar the site adds."""
    return (
        f'<div class="list__item">\n  <dt class="list__label">{label}</dt>\n  <dd class="list__value">\n'
        '    <div class="flex-container flex-container--center">\n'
        f'      <span class="list__value-start">\n        {wins} / {losses} ({wins + losses})\n      </span>\n'
        '<div data-toggle="tooltip" data-placement="bottom" title="61% winst" class="progress-bar">\n'
        ' <span role="progressbar" aria-valuenow="61" class="progress-bar__line" style="width: 61%;"></span>\n'
        "</div>\n    </div>\n  </dd>\n</div>\n"
    )


def stats_form_item(results: tuple[tuple[str, str], ...]) -> str:
    """The "Historie" row: (d-m-yyyy, outcome tag class) per match, W for success and V for danger."""
    tags = "".join(
        f'<li class="list__item">\n<span class="tag--round tag--{kind} tag match__status" title="{day}" '
        f'data-toggle="tooltip" data-placement="bottom">{"W" if kind == "success" else "V"}</span>\n</li>\n'
        for day, kind in results
    )
    return (
        '<div class="list__item">\n  <dt class="list__label">Historie</dt>\n  <dd class="list__value">\n'
        '    <div class="flex-container flex-container--center">\n      <span class="list__value-start">\n'
        f'    <ul class="list--inline list">\n{tags}    </ul>\n      </span>\n    </div>\n  </dd>\n</div>\n'
    )


def stats_tab(name: str, *items: str) -> str:
    return (
        f'<div id="tabStats{name}" class="module"><div class="subheader">\n  <h5 class="subheading">Winst-Verlies</h5>\n'
        '<a role="button" href="/head-2-head?OrganizationCode=X&amp;T1P1MemberID=1" class="btn btn--small btn--link">'
        'Head to Head</a></div>\n<ul class="list list--bordered list--flex margin-bottom">\n'
        + "".join(items)
        + "</ul>\n</div>\n"
    )


def profile_stats_module(*tabs: str) -> str:
    """A profile page up to and including its Statistieken module, followed by the next module's title."""
    return (
        '<div class="module__banner"><h3 class="module__title "><span class="module__title-main">Statistieken</span></h3>'
        '</div><ul class="page-nav--pills js-tabstrip page-nav" role="tablist" id="playerStatsTabs"></ul>'
        + "".join(tabs)
        + '<div class="module__banner"><span class="module__title-main"> Toernooien </span></div>'
    )
