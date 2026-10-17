"""Builders for ranking-site HTML and a fake ranking site, shared by the national player tests."""

import copy
import re


def list_page(week_id="54110", week="40-2026", categories=None):
    categories = {"491": "Mannen Enkel"} if categories is None else categories
    options = f'<option selected="selected" value="{week_id}">{week}</option><option value="1">27-2026</option>'
    links = "".join(
        f'<a href="category.aspx?id={week_id}&category={cid}">{label}</a>'
        f'<a href="category.aspx?id={week_id}&category={cid}">Meer</a>'
        for cid, label in categories.items()
    )
    return f"<html>{options}{links}</html>"


def row_html(rank, player_id, name, member_id, points, matches):
    return (
        f'<tr> <td class="rank"><div style="">{rank}</div></td><td class="rank_equal">&nbsp;</td><td>&nbsp;</td>'
        f'<td><a href="player.aspx?id=54110&player={player_id}">{name}</a></td><td>{member_id}</td>'
        f'<td class="right rankingpoints">{points}</td><td class="right">{matches}</td> </tr>'
    )


def category_page(label, rows, pages=1, category_id="491"):
    pager = "".join(f'<a href="/ranking/category.aspx?id=54110&category={category_id}&p={p}&ps=25">{p}</a>' for p in range(2, pages + 1))
    return f'<table class="ruler"><caption> {label} </caption>{"".join(row_html(*row) for row in rows)}</table>{pager}'


class FakeSite:
    """Serves list pages and category pages for {rid: {weekId, week, categories: {cid: (label, pages)}}}."""

    def __init__(self, lists):
        self.lists = copy.deepcopy(lists)  # tests change the week mid-run; never leak that into shared fixtures
        self.requests = []

    def __call__(self, path, cookie, sleep=None):
        self.requests.append(path)
        rid = re.search(r"ranking\.aspx\?rid=(\d+)", path)
        if rid:
            entry = self.lists[rid.group(1)]
            return list_page(entry["weekId"], entry["week"], {cid: label for cid, (label, _) in entry["categories"].items()})
        category_id, page = re.search(r"category=(\d+)&p=(\d+)", path).groups()
        for entry in self.lists.values():
            if category_id in entry["categories"]:
                label, pages = entry["categories"][category_id]
                member = int(category_id) * 1000 + int(page)
                return category_page(label, [(page, member, f"Player {member}", member, 100 - int(page), 5)], pages, category_id)
        raise AssertionError(f"unexpected path {path}")

    def category_requests(self):
        return [p for p in self.requests if "category.aspx" in p]


class Ticker:
    """A clock that advances one second every time it is read."""

    def __init__(self, step=1.0):
        self.now, self.step = 0.0, step

    def __call__(self):
        value = self.now
        self.now += self.step
        return value
