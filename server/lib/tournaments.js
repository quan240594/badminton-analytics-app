// Folds the tournament scraper's output (data/tournaments.json,
// tournament_details.json, tournament_draws_data.json) into the same
// data.json bundle the league dataset uses, so the client never needs a
// separate fetch for tournament data.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TOURNAMENTS_PATH = path.join(DATA_DIR, 'tournaments.json');
const DETAILS_PATH = path.join(DATA_DIR, 'tournament_details.json');
const DRAWS_DATA_PATH = path.join(DATA_DIR, 'tournament_draws_data.json');
const RANKINGS_PATH = path.join(DATA_DIR, 'rankings.json');

function loadJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

// Same shape as build-static.js's nationalRanking(guid), but keyed directly by
// MemberID - tournament entrants aren't in the league's alias index, and
// rankings.json's "players" dict is already keyed by whatever id fetched each
// page under, which for these is the MemberID (see fetch_tournament_rankings.py).
function nationalRankingFor(rankingsRaw, memberId) {
  const byDiscipline = rankingsRaw.players?.[memberId];
  const result = {};
  for (const discipline of ['singles', 'doubles', 'mixed']) {
    const entry = byDiscipline?.[discipline];
    const top = rankingsRaw.top?.[discipline];
    result[discipline] = entry
      ? {
          rank: entry.rank,
          points: entry.points,
          topPoints: top?.points ?? null,
          topName: top?.name ?? null,
          pctOfTop: top?.points ? entry.points / top.points : null,
        }
      : null;
  }
  return result;
}

// An entrant's local (per-tournament) player id only resolves to their
// site-wide MemberID once they've actually played a scraped match - the
// head-to-head link on a match row is the only place that id is exposed (see
// fetch_tournament_draw.py). Entrants who haven't played yet simply have no
// known MemberID yet, and so no ranking data - a real data gap, not a bug.
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

export function buildTournaments() {
  const tournamentsRaw = loadJson(TOURNAMENTS_PATH, {});
  const details = loadJson(DETAILS_PATH, {});
  const drawsData = loadJson(DRAWS_DATA_PATH, {});
  const rankingsRaw = loadJson(RANKINGS_PATH, { players: {}, top: {} });

  const tournaments = Object.entries(details).map(([id, detail]) => {
    const meta = tournamentsRaw[id] ?? {};
    const idToMember = localIdToMemberId(drawsData[id]);

    const players = (detail.entries || []).map((entry) => {
      const memberId = idToMember.get(entry.player_id) ?? null;
      return {
        id: entry.player_id,
        name: entry.name,
        country: entry.country,
        nationalRanking: memberId ? nationalRankingFor(rankingsRaw, memberId) : null,
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
