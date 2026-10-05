// Reproduces the server's in-memory pipeline (loadDataset -> computeRatings ->
// computeCareerStats -> playerSummary) as a one-shot static JSON bundle, so the
// GitHub Pages build has no live backend to query at request time.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadDataset } from './lib/dataset.js';
import { computeRatings } from './lib/elo.js';
import { computeCareerStats } from './lib/stats.js';
import { listPlayerSummaries, poolMeta } from './lib/summary.js';
import { buildTournaments } from './lib/tournaments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data.json');

const { players, matches, rankings, rankingTop, highestDivisionPlayed, titlesForPlayer, titleCounts, titleYears, aliasIndex } = loadDataset();
const { singles, doublesPlayer, mixedPlayer, singlesH2H, doublesPairH2H, mixedPairH2H } = computeRatings(matches);
const careerStats = computeCareerStats(matches);

const playerList = listPlayerSummaries(
  { players, matches, singles, doublesPlayer, mixedPlayer, careerStats, rankings, rankingTop, highestDivisionPlayed, titlesForPlayer, titleCounts },
  aliasIndex,
  { withConfidence: true }
);

const bundle = {
  meta: {
    lastUpdated: new Date().toISOString(),
    playerCount: playerList.length,
    ...poolMeta(aliasIndex, titleYears),
  },
  players: playerList,
  singlesH2H: Object.fromEntries(singlesH2H),
  doublesPairH2H: Object.fromEntries(doublesPairH2H),
  mixedPairH2H: Object.fromEntries(mixedPairH2H),
  tournaments: buildTournaments(playerList),
};

mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(bundle));
console.log(`wrote ${playerList.length} players to ${OUT_PATH}`);
