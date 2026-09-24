import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAREER_PATH = path.join(__dirname, '..', '..', 'data', 'career.json');
const RANKINGS_PATH = path.join(__dirname, '..', '..', 'data', 'rankings.json');
const TITLES_PATH = path.join(__dirname, '..', '..', 'data', 'titles.json');
const CURRENT_TOURNAMENT_ID = '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E';

function parseDutchDateTime(time) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(time || '');
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)).getTime();
}

// Ladder rank: lower is "higher" division. Eredivisie=0, "Ne divisie"=N. Veteran/
// non-ladder categories (Veer, Nylon, etc.) sort after the numbered ladder.
function divisionRank(division) {
  if (!division) return Infinity;
  if (/^Eredivisie$/i.test(division)) return 0;
  const m = /^(\d+)e divisie$/i.exec(division);
  if (m) return Number(m[1]);
  return Infinity;
}

function parseDivisionFromDraw(draw) {
  if (!draw) return null;
  const parts = draw.split(/\s[\u2013-]\s/); // split on " – " or " - "
  return parts.length > 1 ? parts[1].trim() : null;
}

function parseYearFromTime(time) {
  const m = /\d{2}\/\d{2}\/(\d{4})/.exec(time || '');
  return m ? Number(m[1]) : null;
}

function disciplineFromEvent(event) {
  if (!event) return null;
  if (/^(MS|WS|Single)/.test(event)) return 'singles';
  if (/^XD/.test(event)) return 'mixed';
  if (/^(MD|WD)/.test(event)) return 'doubles';
  return null;
}

// Opponents are hyperlinked on a player's own page, but the page owner never links to
// themselves — so the owner is always missing from whichever side's roster is short.
function reconstructRoster(match, ownerId, ownerName) {
  const home = [...match.home_players];
  const away = [...match.away_players];
  const ownerEntry = [ownerId, ownerName];
  if (home.length <= away.length) {
    home.push(ownerEntry);
  } else {
    away.push(ownerEntry);
  }
  return { home, away };
}

export function loadDataset() {
  const raw = JSON.parse(readFileSync(CAREER_PATH, 'utf-8'));
  const players = new Map();
  const seenMatchKeys = new Set();
  const canonicalMatches = [];

  for (const [guid, profile] of Object.entries(raw)) {
    players.set(guid, { id: guid, name: profile.name, club: profile.club });
  }

  // Per-tournament numeric ids only resolve to a global guid if that alias was seen
  // while building career.json (i.e. that participant's own page was fetched too).
  const aliasIndex = new Map();
  for (const [guid, profile] of Object.entries(raw)) {
    for (const key of Object.keys(profile.aliases || {})) {
      aliasIndex.set(key, guid);
    }
  }

  for (const profile of Object.values(raw)) {
    for (const match of profile.matches) {
      const { tournament_id, source_player_id, event, time, draw, home_team, away_team, score, winner_side } = match;
      const { home, away } = reconstructRoster(match, source_player_id, profile.name);
      const total = home.length + away.length;
      // Doubles vs. mixed doubles can't be inferred from roster size alone (both are 2v2),
      // so unrecognized event codes (e.g. generic "D"/"T") only fall back to singles.
      const discipline = disciplineFromEvent(event) || (total === 2 ? 'singles' : null);
      if (!discipline) continue;
      if (discipline === 'singles' && (home.length !== 1 || away.length !== 1)) continue;
      if ((discipline === 'doubles' || discipline === 'mixed') && (home.length !== 2 || away.length !== 2)) continue;

      const homeIds = home.map(([id]) => id).sort().join('+');
      const awayIds = away.map(([id]) => id).sort().join('+');
      const key = [tournament_id, time, event, home_team, away_team, homeIds, awayIds, score].join('|');
      if (seenMatchKeys.has(key)) continue;
      seenMatchKeys.add(key);

      const resolveGuid = (localId) => aliasIndex.get(`${tournament_id}:${localId}`) || null;

      canonicalMatches.push({
        tournamentId: tournament_id,
        time,
        timestamp: parseDutchDateTime(time),
        year: parseYearFromTime(time),
        division: parseDivisionFromDraw(draw),
        discipline,
        event,
        homeTeam: home_team,
        awayTeam: away_team,
        home: home.map(([id, name]) => ({ id, name, guid: resolveGuid(id) })),
        away: away.map(([id, name]) => ({ id, name, guid: resolveGuid(id) })),
        score,
        winnerSide: winner_side,
      });
    }
  }

  canonicalMatches.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  // Ranking pages were fetched keyed by this season's local player id, so resolve
  // them to a guid the same way opponents are resolved (via the alias index).
  const rankingsRaw = JSON.parse(readFileSync(RANKINGS_PATH, 'utf-8'));
  const rankingsByGuid = new Map();
  for (const [localId, byDiscipline] of Object.entries(rankingsRaw.players)) {
    const guid = aliasIndex.get(`${CURRENT_TOURNAMENT_ID}:${localId}`);
    if (guid) rankingsByGuid.set(guid, byDiscipline);
  }

function highestDivisionPlayed(matches, guid) {
  let best = null;
  for (const m of matches) {
    if (!m.division) continue;
    const inMatch = m.home.some((p) => p.guid === guid) || m.away.some((p) => p.guid === guid);
    if (!inMatch) continue;
    const rank = divisionRank(m.division);
    if (!best || rank < best.rank || (rank === best.rank && (m.year ?? 0) > (best.year ?? 0))) {
      best = { division: m.division, year: m.year, rank };
    }
  }
  return best ? { division: best.division, year: best.year } : null;
}

  // Entries per player are already ordered most-recent-first (year desc, then page order).
  let titlesRaw = {};
  try {
    titlesRaw = JSON.parse(readFileSync(TITLES_PATH, 'utf-8'));
  } catch {
    titlesRaw = {};
  }

  // Lower rank = better placement; unrecognized statuses sort after known ones.
  const STATUS_RANK = { Winner: 0, Finalist: 1, 'Semi-finalist': 2, 'Quarter-finalist': 3 };

  function titlesForPlayer(guid) {
    const entries = titlesRaw[guid] || [];
    const best = { singles: null, doubles: null, mixed: null };
    for (const entry of entries) {
      if (!entry.category) continue;
      const rank = STATUS_RANK[entry.status] ?? 99;
      const current = best[entry.category];
      if (!current || rank < current.rank || (rank === current.rank && entry.year > current.year)) {
        best[entry.category] = { status: entry.status, tournament: entry.tournament, year: entry.year, rank };
      }
    }
    const result = {};
    for (const key of Object.keys(best)) {
      result[key] = best[key] ? { status: best[key].status, tournament: best[key].tournament, year: best[key].year } : null;
    }
    return result;
  }

  function emptyMedalCounts() {
    return { gold: 0, silver: 0, bronze: 0 };
  }

  function tallyMedals(counts, status) {
    if (status === 'Winner') counts.gold += 1;
    else if (status === 'Finalist') counts.silver += 1;
    else if (status === 'Semi-finalist') counts.bronze += 1;
  }

  // Every player's card shows the same fixed set of years (ascending) so the
  // stacked tables stay the same height regardless of which player is selected.
  const titleYears = [...new Set(
    Object.entries(titlesRaw)
      .filter(([guid]) => !guid.startsWith('noguid:'))
      .flatMap(([, entries]) => entries.map((e) => e.year))
  )].sort((a, b) => a - b);

  function titleCounts(guid) {
    const entries = titlesRaw[guid] || [];
    const byYear = {};
    const total = emptyMedalCounts();
    for (const year of titleYears) byYear[year] = emptyMedalCounts();
    for (const entry of entries) {
      tallyMedals(total, entry.status);
      if (byYear[entry.year]) tallyMedals(byYear[entry.year], entry.status);
    }
    return { byYear, total };
  }

  return {
    players,
    matches: canonicalMatches,
    rankings: rankingsByGuid,
    rankingTop: rankingsRaw.top,
    highestDivisionPlayed,
    titlesForPlayer,
    titleCounts,
    titleYears,
    aliasIndex,
  };
}
