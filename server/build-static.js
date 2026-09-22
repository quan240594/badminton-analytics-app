// Reproduces the server's in-memory pipeline (loadDataset -> computeRatings ->
// computeCareerStats -> playerSummary) as a one-shot static JSON bundle, so the
// GitHub Pages build has no live backend to query at request time.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadDataset } from './lib/dataset.js';
import { computeRatings } from './lib/elo.js';
import { computeCareerStats } from './lib/stats.js';
import { currentSeasonLabel } from './lib/season.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data.json');
const CURRENT_POOL_LABEL = `Bondscompetitie ${currentSeasonLabel()} \u2013 Mannen Veer 2 afd. 12`;

const { players, matches, rankings, rankingTop, highestDivisionPlayed, titlesForPlayer, titleCounts, titleYears } = loadDataset();
const { singles, doublesPlayer, mixedPlayer, singlesH2H, doublesPairH2H, mixedPairH2H } = computeRatings(matches);
const careerStats = computeCareerStats(matches);

function careerBucket(guid, discipline) {
  return (
    careerStats.get(guid)?.[discipline] ?? {
      played: 0,
      won: 0,
      setsPlayed: 0,
      setsWon: 0,
      pointsPlayed: 0,
      pointsWon: 0,
    }
  );
}

function winRate(won, played) {
  return played > 0 ? won / played : null;
}

function disciplineFields(prefix, rating, career) {
  return {
    [`${prefix}Rating`]: Math.round(rating ?? 1500),
    [`${prefix}Played`]: career.played,
    [`${prefix}Won`]: career.won,
    [`${prefix}WinRate`]: winRate(career.won, career.played),
    [`${prefix}SetsPlayed`]: career.setsPlayed,
    [`${prefix}SetsWon`]: career.setsWon,
    [`${prefix}SetsWinRate`]: winRate(career.setsWon, career.setsPlayed),
    [`${prefix}PointsPlayed`]: career.pointsPlayed,
    [`${prefix}PointsWon`]: career.pointsWon,
    [`${prefix}PointsWinRate`]: winRate(career.pointsWon, career.pointsPlayed),
  };
}

function nationalRanking(guid) {
  const byDiscipline = rankings.get(guid);
  const result = {};
  for (const discipline of ['singles', 'doubles', 'mixed']) {
    const entry = byDiscipline?.[discipline];
    const top = rankingTop?.[discipline];
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

function playerSummary(guid) {
  const profile = players.get(guid);
  if (!profile) return null;
  const s = singles.get(guid);
  const d = doublesPlayer.get(guid);
  const m = mixedPlayer.get(guid);
  return {
    id: guid,
    name: profile.name,
    club: profile.club,
    ...disciplineFields('singles', s?.rating, careerBucket(guid, 'singles')),
    ...disciplineFields('doubles', d?.rating, careerBucket(guid, 'doubles')),
    ...disciplineFields('mixed', m?.rating, careerBucket(guid, 'mixed')),
    nationalRanking: nationalRanking(guid),
    highestDivision: highestDivisionPlayed(matches, guid),
    titles: titlesForPlayer(guid),
    titleCounts: titleCounts(guid),
    singlesConfidence: confidenceLabel(s?.played ?? 0),
    doublesConfidence: confidenceLabel(d?.played ?? 0),
    mixedConfidence: confidenceLabel(m?.played ?? 0),
  };
}

function confidenceLabel(played) {
  if (played >= 15) return 'high';
  if (played >= 5) return 'medium';
  return 'low';
}

// Historical event pages where profile-GUID parsing failed left inert 0-match placeholders in career.json.
const playerList = [...players.keys()]
  .map(playerSummary)
  .filter((p) => p && (p.singlesPlayed > 0 || p.doublesPlayed > 0 || p.mixedPlayed > 0));
playerList.sort((a, b) => a.name.localeCompare(b.name));

const bundle = {
  meta: {
    lastUpdated: new Date().toISOString(),
    poolLabel: CURRENT_POOL_LABEL,
    playerCount: playerList.length,
    titleYears,
  },
  players: playerList,
  singlesH2H: Object.fromEntries(singlesH2H),
  doublesPairH2H: Object.fromEntries(doublesPairH2H),
  mixedPairH2H: Object.fromEntries(mixedPairH2H),
};

mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(bundle));
console.log(`wrote ${playerList.length} players to ${OUT_PATH}`);
