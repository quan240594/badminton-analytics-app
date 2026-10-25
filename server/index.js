import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { loadDataset } from './lib/dataset.js';
import { computeRatings, winProbability } from './lib/elo.js';
import { computeCareerStats } from './lib/stats.js';
import { confidenceLabel, listPlayerSummaries, playerSummary, poolMeta } from './lib/summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROGRESS_PATH = path.join(DATA_DIR, 'refresh_progress.json');
const POOL_PROGRESS_PATH = path.join(DATA_DIR, 'pool_fetch_progress.json'); // was never declared - /api/refresh/pool/progress silently fell back every call
// Avoids a PATH-lookup hotspot (S4036) for the one spawn() call that re-invokes
// ourself - process.execPath is always this exact running Node binary.
const NODE_EXECUTABLE = process.execPath;
// Same idea for the python3 spawn calls below: resolve to one of the common
// absolute install locations if present, falling back to a bare PATH lookup
// (today's exact behavior) only if none of them exist on this machine.
const PYTHON_CANDIDATES = ['/usr/local/bin/python3', '/opt/homebrew/bin/python3', '/usr/bin/python3'];
const PYTHON_EXECUTABLE = PYTHON_CANDIDATES.find((p) => existsSync(p)) || 'python3';

let players, matches, rankings, rankingTop, highestDivisionPlayedFn, titlesForPlayerFn, titleCountsFn, titleYears, aliasIndex;
let singles, doublesPlayer, mixedPlayer, singlesH2H, doublesPairH2H;
let careerStats;
let lastUpdated = null;
let refreshing = false;

function loadAll() {
  ({ players, matches, rankings, rankingTop, highestDivisionPlayed: highestDivisionPlayedFn, titlesForPlayer: titlesForPlayerFn, titleCounts: titleCountsFn, titleYears, aliasIndex } = loadDataset());
  ({ singles, doublesPlayer, mixedPlayer, singlesH2H, doublesPairH2H } = computeRatings(matches));
  careerStats = computeCareerStats(matches);
  lastUpdated = new Date().toISOString();
}

loadAll();

// Keeps only the last 2000 chars of a child's stderr, for error reporting on exit.
function trackStderrTail(child) {
  const tail = { text: '' };
  child.stderr.on('data', (chunk) => {
    tail.text = (tail.text + chunk.toString()).slice(-2000);
  });
  return tail;
}

// Rebuilds client/public/data.json so the static-site client (which reads that
// bundle, not this live API) actually sees the data refresh_data.py just fetched.
function rebuildStaticBundle() {
  return new Promise((resolve, reject) => {
    const build = spawn(NODE_EXECUTABLE, ['build-static.js'], { cwd: __dirname });
    const stderr = trackStderrTail(build);
    build.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.text || `build-static.js exited with code ${code}`));
    });
    build.on('error', reject);
  });
}

// Runs one data-refresh script, then reloads the in-memory dataset and rebuilds data.json.
function runRefreshJob(label, args) {
  refreshing = true;
  const child = spawn(PYTHON_EXECUTABLE, args, { cwd: DATA_DIR });
  const stderr = trackStderrTail(child);
  child.on('close', (code) => {
    if (code !== 0) {
      refreshing = false;
      console.error(`[${label}] failed with exit code ${code}`);
      if (stderr.text) console.error(`[${label}] stderr: ${stderr.text}`);
      return;
    }
    loadAll();
    rebuildStaticBundle()
      .then(() => console.log(`[${label}] reloaded ${players.size} players and rebuilt data.json at ${lastUpdated}`))
      .catch((err) => console.error(`[${label}] failed to rebuild static bundle: ${err.message}`))
      .finally(() => {
        refreshing = false;
      });
  });
  child.on('error', (err) => {
    refreshing = false;
    console.error(`[${label}] failed to start: ${err.message}`);
  });
}

function progressHandler(progressPath) {
  return (req, res) => {
    try {
      const raw = readFileSync(progressPath, 'utf-8');
      res.json(JSON.parse(raw));
    } catch {
      res.json({ step: refreshing ? 'starting' : 'idle', percent: refreshing ? 0 : 100, running: refreshing, error: null });
    }
  };
}

function summaryContext() {
  return {
    players, matches, singles, doublesPlayer, mixedPlayer, careerStats, rankings, rankingTop,
    highestDivisionPlayed: highestDivisionPlayedFn,
    titlesForPlayer: titlesForPlayerFn,
    titleCounts: titleCountsFn,
  };
}

const app = express();
app.disable('x-powered-by');
// Local dev only: the client either hits this API through Vite's dev proxy
// (browser origin :5173, see client/vite.config.js) or, rarely, directly
// against this server's own port - production (GitHub Pages) ships a static
// data.json and never calls this API at all (see client/src/api.js).
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4000'] }));
app.use(express.json());

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

app.get('/api/players', (req, res) => {
  res.json(listPlayerSummaries(summaryContext(), aliasIndex));
});

app.get('/api/players/:id', (req, res) => {
  const summary = playerSummary(summaryContext(), req.params.id);
  if (!summary) return res.status(404).json({ error: 'player not found' });
  res.json(summary);
});

app.get('/api/meta', (req, res) => {
  res.json({
    lastUpdated,
    refreshing,
    playerCount: players.size,
    ...poolMeta(aliasIndex, titleYears),
  });
});

app.get('/api/refresh/progress', progressHandler(PROGRESS_PATH));

app.post('/api/refresh', (req, res) => {
  if (refreshing) return res.status(409).json({ error: 'refresh already in progress' });
  runRefreshJob('refresh', ['refresh_data.py']);
  res.status(202).json({ started: true });
});

app.get('/api/refresh/pool/progress', progressHandler(POOL_PROGRESS_PATH));

// Scoped alternative to /api/refresh: only fetches the players/matches for one
// pool (fetch_pool.py), so selecting a team doesn't pay for a full national refresh.
app.post('/api/refresh/pool', (req, res) => {
  const { drawId } = req.body || {};
  if (!drawId) return res.status(400).json({ error: 'drawId is required' });
  if (!/^\d+$/.test(String(drawId))) return res.status(400).json({ error: 'drawId must be numeric' });
  if (refreshing) return res.status(409).json({ error: 'a refresh is already in progress' });
  // Reconstructed as a fresh value (not the original tainted string) after validation.
  const safeDrawId = String(Number(drawId));
  runRefreshJob('refresh/pool', ['fetch_pool.py', '--draw-id', safeDrawId]);
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

  const h2hKey = [playerAId, playerBId].sort((a, b) => a.localeCompare(b)).join('|');
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

  const pairKeyA = [...teamA].sort((a, b) => a.localeCompare(b)).join('+');
  const pairKeyB = [...teamB].sort((a, b) => a.localeCompare(b)).join('+');
  const matchupKey = [pairKeyA, pairKeyB].sort((a, b) => a.localeCompare(b)).join('_vs_');
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
export const server = app.listen(PORT, () => {
  console.log(`badminton-app server listening on http://localhost:${PORT}`);
  console.log(`loaded ${players.size} players, ${matches.length} canonical matches`);
});

export { app };
