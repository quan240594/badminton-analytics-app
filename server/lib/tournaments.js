// Folds the tournament scraper's output (data/tournaments.json,
// tournament_details.json, tournament_draws_data.json) into the same
// data.json bundle the league dataset uses, so the client never needs a
// separate fetch for tournament data.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { nationalRankingFor } from './nationalRanking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TOURNAMENTS_PATH = path.join(DATA_DIR, 'tournaments.json');
const DETAILS_PATH = path.join(DATA_DIR, 'tournament_details.json');
const DRAWS_DATA_PATH = path.join(DATA_DIR, 'tournament_draws_data.json');
const RANKINGS_PATH = path.join(DATA_DIR, 'rankings.json');
const ENTRANT_RANKINGS_PATH = path.join(DATA_DIR, 'entrant_rankings.json');

function loadJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

// An entrant's local (per-tournament) player id resolves to their site-wide
// MemberID once they've played a scraped match - the head-to-head link on a
// match row exposes it (see fetch_tournament_draw.py). Entrants who haven't
// played yet are resolved separately by fetch_entrant_rankings.py instead.
function localIdToMemberId(drawsForTournament) {
  const map = new Map();
  for (const draw of Object.values(drawsForTournament || {})) {
    for (const match of draw.matches || []) {
      for (const side of match.sides || []) {
        for (const player of side.players || []) {
          if (player.member_id) map.set(player.player_id, player.member_id);
        }
      }
    }
  }
  return map;
}

// Tournament entries are "Last, First [infix]" while league players are "First
// [infix] Last (Nickname)", and either side may carry accents - so compare the
// sorted set of accent-stripped words (nicknames in brackets dropped), which
// makes the word order irrelevant.
export function nameKey(name) {
  return (String(name ?? '').replace(/\([^)]{0,100}\)/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? []).sort().join(' ');
}

// League players grouped by name key. A name only counts as identifying when
// exactly one league player has it - two people sharing a name must never
// inherit each other's ranking, so ambiguous names are left out entirely.
function uniqueLeagueRankingsByName(leaguePlayers) {
  const byKey = new Map();
  for (const player of leaguePlayers) {
    const key = nameKey(player.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(player);
  }
  const unique = new Map();
  for (const [key, players] of byKey) {
    if (players.length === 1) unique.set(key, players[0].nationalRanking ?? null);
  }
  return unique;
}

const hasAnyRanking = (ranking) => Boolean(ranking) && ['singles', 'doubles', 'mixed'].some((d) => ranking[d]);

// Ranking sources for an entrant, most to least exact: the MemberID seen in a
// played match, the MemberID resolved from the player's site profile
// (fetch_entrant_rankings.py), and finally - only when given leaguePlayers - the
// league player of the same name.
export function buildTournaments(leaguePlayers = []) {
  const leagueRankingByName = uniqueLeagueRankingsByName(leaguePlayers);
  const tournamentsRaw = loadJson(TOURNAMENTS_PATH, {});
  const details = loadJson(DETAILS_PATH, {});
  const drawsData = loadJson(DRAWS_DATA_PATH, {});
  const rankingsRaw = loadJson(RANKINGS_PATH, { players: {}, top: {} });
  const entrantState = loadJson(ENTRANT_RANKINGS_PATH, { entries: {}, rankings: {} });

  const tournaments = Object.entries(details).map(([id, detail]) => {
    const meta = tournamentsRaw[id] ?? {};
    const idToMember = localIdToMemberId(drawsData[id]);

    const players = (detail.entries || []).map((entry) => {
      const memberId = idToMember.get(entry.player_id) ?? null;
      const fromMatches = memberId ? nationalRankingFor(rankingsRaw.players?.[memberId], rankingsRaw.top) : null;
      const entrantMemberId = entrantState.entries?.[`${id}:${entry.player_id}`] ?? null;
      const fromProfile = entrantMemberId
        ? nationalRankingFor(entrantState.rankings?.[entrantMemberId]?.ranking ?? rankingsRaw.players?.[entrantMemberId], rankingsRaw.top)
        : null;
      const fromLeague = leagueRankingByName.get(nameKey(entry.name)) ?? null;
      return {
        id: entry.player_id,
        name: entry.name,
        country: entry.country,
        nationalRanking: [fromMatches, fromProfile, fromLeague].find(hasAnyRanking) ?? fromMatches,
      };
    });

    const draws = (detail.draws || []).map((draw) => ({
      ...draw,
      standings: drawsData[id]?.[draw.draw_id]?.standings ?? [],
      matches: drawsData[id]?.[draw.draw_id]?.matches ?? [],
    }));

    return {
      id,
      name: meta.name ?? id,
      club: meta.club ?? null,
      location: meta.location ?? null,
      dates: meta.dates ?? [],
      events: detail.events || [],
      draws,
      players,
    };
  });

  tournaments.sort((a, b) => a.name.localeCompare(b.name));
  return tournaments;
}
