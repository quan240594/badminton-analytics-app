const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const parseDay = (text) => {
  const match = DAY_RE.exec(text ?? '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};

export const tournamentUrl = (id) => `https://badmintonnederland.toernooi.nl/sport/tournament?id=${id}`;

// The player's entries (tournament id + events) that have not finished yet, soonest first.
// A tournament without known dates cannot be placed in time, so it is left out.
export function upcomingTournaments(entries, tournaments, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const byId = new Map(tournaments.map((t) => [t.id, t]));
  return (entries ?? [])
    .map(({ id, events }) => {
      const tournament = byId.get(id);
      const first = parseDay(tournament?.dates?.[0]);
      const last = parseDay(tournament?.dates?.at(-1));
      if (!first || !last || last < today) return null;
      return { id, name: tournament.name, location: tournament.location, first, last, events: events ?? [] };
    })
    .filter(Boolean)
    .sort((a, b) => a.first - b.first);
}

const formatDay = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateRange = (first, last) => (first.getTime() === last.getTime() ? formatDay(first) : `${formatDay(first)} – ${formatDay(last)}`);
