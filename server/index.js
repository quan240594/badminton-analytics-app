import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadDataset } from './lib/dataset.js';
import { computeRatings, winProbability } from './lib/elo.js';
import { computeCareerStats } from './lib/stats.js';
import { currentSeasonLabel } from './lib/season.js';
import { fullLeagueIndex, currentPoolTeams, fetchedDrawIds, poolRosters, substitutePlayerIds, playerGenders } from './lib/leagueIndex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROGRESS_PATH = path.join(DATA_DIR, 'refresh_progress.json');

let players, matches, rankings, rankingTop, highestDivisionPlayedFn, titlesForPlayerFn, titleCountsFn, titleYears, aliasIndex;
let singles, doublesPlayer, mixedPlayer, singlesH2H, doublesPairH2H;
let careerStats;
let lastUpdated = null;
const CURRENT_POOL_LABEL = `Bondscompetitie ${currentSeasonLabel()} \u2013 Mannen Veer 2 afd. 12`;
let refreshing = false;

function loadAll() {
  ({ players, matches, rankings, rankingTop, highestDivisionPlayed: highestDivisionPlayedFn, titlesForPlayer: titlesForPlayerFn, titleCounts: titleCountsFn, titleYears, aliasIndex } = loadDataset());
  ({ singles, doublesPlayer, mixedPlayer, singlesH2H, doublesPairH2H } = computeRatings(matches));
  careerStats = computeCareerStats(matches);
  lastUpdated = new Date().toISOString();
}

loadAll();

// Rebuilds client/public/data.json so the static-site client (which reads that
// bundle, not this live API) actually sees the data refresh_data.py just fetched.
function rebuildStaticBundle() {
  return new Promise((resolve, reject) => {
    const build = spawn('node', ['build-static.js'], { cwd: __dirname });
    let stderrTail = '';
    build.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    build.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrTail || `build-static.js exited with code ${code}`));
    });
    build.on('error', reject);
  });
}

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

const app = express();
app.use(cors());
app.use(express.json());

function confidenceLabel(played) {
  if (played >= 15) return 'high';
  if (played >= 5) return 'medium';
  return 'low';
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
    highestDivision: highestDivisionPlayedFn(matches, guid),
    titles: titlesForPlayerFn(guid),
    titleCounts: titleCountsFn(guid),
  };
}

function playerDetail(id, book) {
  const b = book.get(id);
  const p = players.get(id);
  return {
    id,
    name: p.name,
    rating: Math.round(b?.rating ?? 1500),
    played: b?.played ?? 0,
    confidence: confidenceLabel(b?.played ?? 0),
  };
}

const CURRENT_TOURNAMENT_ID = '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E';

app.get('/api/players', (req, res) => {
  // Historical event pages where profile-GUID parsing failed left inert 0-match
  // placeholders in career.json - filtered out, unless the profile is a genuine
  // current-season roster member (has a current-tournament alias even with 0
  // matches), since a player who's registered but hasn't played yet is real
  // data, not a parse failure.
  const currentSeasonGuids = new Set();
  for (const [key, guid] of aliasIndex) {
    if (key.startsWith(`${CURRENT_TOURNAMENT_ID}:`)) currentSeasonGuids.add(guid);
  }
  const list = [...players.keys()]
    .map(playerSummary)
    .filter((p) => p && (p.singlesPlayed > 0 || p.doublesPlayed > 0 || p.mixedPlayed > 0 || currentSeasonGuids.has(p.id)));
  list.sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

app.get('/api/players/:id', (req, res) => {
  const summary = playerSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: 'player not found' });
  res.json(summary);
});

app.get('/api/meta', (req, res) => {
  const currentPool = currentPoolTeams(CURRENT_POOL_LABEL);
  res.json({
    lastUpdated,
    refreshing,
    playerCount: players.size,
    poolLabel: CURRENT_POOL_LABEL,
    titleYears,
    currentPool,
    leagueIndex: fullLeagueIndex(),
    fetchedDrawIds: fetchedDrawIds(currentPool.drawId),
    poolRosters: poolRosters(aliasIndex),
    substitutePlayerIds: substitutePlayerIds(aliasIndex),
    playerGenders: playerGenders(aliasIndex),
  });
});

app.get('/api/refresh/progress', (req, res) => {
  try {
    const raw = readFileSync(PROGRESS_PATH, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.json({ step: refreshing ? 'starting' : 'idle', percent: refreshing ? 0 : 100, running: refreshing, error: null });
  }
});

app.post('/api/refresh', (req, res) => {
  if (refreshing) return res.status(409).json({ error: 'refresh already in progress' });
  refreshing = true;
  const child = spawn('python3', ['refresh_data.py'], { cwd: DATA_DIR });
  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  child.on('close', (code) => {
    if (code !== 0) {
      refreshing = false;
      console.error(`[refresh] failed with exit code ${code}`);
      if (stderrTail) console.error(`[refresh] stderr: ${stderrTail}`);
      return;
    }
    loadAll();
    rebuildStaticBundle()
      .then(() => console.log(`[refresh] reloaded ${players.size} players and rebuilt data.json at ${lastUpdated}`))
      .catch((err) => console.error(`[refresh] failed to rebuild static bundle: ${err.message}`))
      .finally(() => {
        refreshing = false;
      });
  });
  child.on('error', (err) => {
    refreshing = false;
    console.error(`[refresh] failed to start: ${err.message}`);
  });
  res.status(202).json({ started: true });
});

app.get('/api/refresh/pool/progress', (req, res) => {
  try {
    const raw = readFileSync(POOL_PROGRESS_PATH, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.json({ step: refreshing ? 'starting' : 'idle', percent: refreshing ? 0 : 100, running: refreshing, error: null });
  }
});

// Scoped alternative to /api/refresh: only fetches the players/matches for one
// pool (fetch_pool.py), so selecting a team doesn't pay for a full national refresh.
app.post('/api/refresh/pool', (req, res) => {
  const { drawId } = req.body || {};
  if (!drawId) return res.status(400).json({ error: 'drawId is required' });
  if (refreshing) return res.status(409).json({ error: 'a refresh is already in progress' });
  refreshing = true;
  const child = spawn('python3', ['fetch_pool.py', '--draw-id', String(drawId)], { cwd: DATA_DIR });
  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  child.on('close', (code) => {
    if (code !== 0) {
      refreshing = false;
      console.error(`[refresh/pool] failed with exit code ${code}`);
      if (stderrTail) console.error(`[refresh/pool] stderr: ${stderrTail}`);
      return;
    }
    loadAll();
    rebuildStaticBundle()
      .then(() => console.log(`[refresh/pool] reloaded ${players.size} players and rebuilt data.json at ${lastUpdated}`))
      .catch((err) => console.error(`[refresh/pool] failed to rebuild static bundle: ${err.message}`))
      .finally(() => {
        refreshing = false;
      });
  });
  child.on('error', (err) => {
    refreshing = false;
    console.error(`[refresh/pool] failed to start: ${err.message}`);
  });
  res.status(202).json({ started: true });
});

app.post('/api/simulate/singles', (req, res) => {
  const { playerAId, playerBId } = req.body || {};
  const profileA = players.get(playerAId);
  const profileB = players.get(playerBId);
  if (!profileA || !profileB) return res.status(400).json({ error: 'unknown player id(s)' });
  if (playerAId === playerBId) return res.status(400).json({ error: 'players must be different' });

  const a = playerDetail(playerAId, singles);
  const b = playerDetail(playerBId, singles);
  const probA = winProbability(a.rating, b.rating);

  const h2hKey = [playerAId, playerBId].sort().join('|');
  const h2h = singlesH2H.get(h2hKey);

  res.json({
    playerA: a,
    playerB: b,
    winProbabilityA: probA,
    winProbabilityB: 1 - probA,
    headToHead: h2h ? { playerAWins: h2h[playerAId] || 0, playerBWins: h2h[playerBId] || 0 } : null,
  });
});

app.post('/api/simulate/doubles', (req, res) => {
  const { teamA, teamB } = req.body || {};
  if (!Array.isArray(teamA) || teamA.length !== 2 || !Array.isArray(teamB) || teamB.length !== 2) {
    return res.status(400).json({ error: 'teamA and teamB must each have exactly 2 player ids' });
  }
  const allIds = [...teamA, ...teamB];
  if (new Set(allIds).size !== 4) return res.status(400).json({ error: 'all four players must be different' });
  if (allIds.some((id) => !players.get(id))) return res.status(400).json({ error: 'unknown player id(s)' });

  const teamADetail = teamA.map((id) => playerDetail(id, doublesPlayer));
  const teamBDetail = teamB.map((id) => playerDetail(id, doublesPlayer));
  const teamARating = (teamADetail[0].rating + teamADetail[1].rating) / 2;
  const teamBRating = (teamBDetail[0].rating + teamBDetail[1].rating) / 2;
  const probA = winProbability(teamARating, teamBRating);

  const pairKeyA = [...teamA].sort().join('+');
  const pairKeyB = [...teamB].sort().join('+');
  const matchupKey = [pairKeyA, pairKeyB].sort().join('_vs_');
  const h2h = doublesPairH2H.get(matchupKey);

  res.json({
    teamA: teamADetail,
    teamB: teamBDetail,
    teamARating: Math.round(teamARating),
    teamBRating: Math.round(teamBRating),
    winProbabilityA: probA,
    winProbabilityB: 1 - probA,
    headToHead: h2h ? { teamAWins: h2h[pairKeyA] || 0, teamBWins: h2h[pairKeyB] || 0 } : null,
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`badminton-app server listening on http://localhost:${PORT}`);
  console.log(`loaded ${players.size} players, ${matches.length} canonical matches`);
});
