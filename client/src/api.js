// Static-site data layer: the whole dataset ships as one prebuilt data.json
// (see server/build-static.js), fetched once and cached; there is no backend
// to query at request time, so "simulate" is computed client-side from it.
let bundlePromise = null;

function loadBundle() {
  if (!bundlePromise) {
    bundlePromise = fetch(`${import.meta.env.BASE_URL}data.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load data.json: ${res.status}`);
      return res.json();
    });
  }
  return bundlePromise;
}

export const fetchPlayers = () => loadBundle().then((b) => b.players);

export const fetchMeta = () => loadBundle().then((b) => b.meta);

// Local-dev only: triggers server/index.js's live scrape + data.json rebuild via
// vite's dev proxy; on the static GitHub Pages build there's no backend to hit.
export async function triggerRefresh() {
  const res = await fetch('/api/refresh', { method: 'POST' });
  if (res.status === 409) throw new Error('A refresh is already in progress.');
  if (!res.ok) throw new Error(`Could not reach the local refresh server (${res.status}).`);
}

export const fetchRefreshProgress = () => fetch('/api/refresh/progress').then((res) => res.json());

// Drops the cached bundle and cache-busts, so a re-read picks up a freshly
// deployed data.json instead of a stale copy GitHub Pages/the browser cached.
export function reloadBundle() {
  bundlePromise = fetch(`${import.meta.env.BASE_URL}data.json?t=${Date.now()}`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load data.json: ${res.status}`);
    return res.json();
  });
  return bundlePromise;
}

// Production (GitHub Pages) has no backend, so "Fetch data" instead calls the
// GitHub Actions API directly to (re)run the same refresh-data + build-and-deploy
// workflow the Friday cron uses. Requires a token with Actions read/write, entered
// by the user at runtime and kept only in sessionStorage (never bundled/committed).
const GH_OWNER = 'quan240594';
const GH_REPO = 'badminton-analytics-app';
const GH_WORKFLOW_FILE = 'deploy.yml';
const GH_TOKEN_KEY = 'badminton-app-gh-token';
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_FILE}`;

function getGithubToken() {
  let token = sessionStorage.getItem(GH_TOKEN_KEY);
  if (!token) {
    token = window.prompt(
      'GitHub token with Actions read/write (or "repo") scope.\n' +
        'Used only for this browser tab (kept in sessionStorage, sent only to api.github.com).'
    );
    if (token) sessionStorage.setItem(GH_TOKEN_KEY, token);
  }
  return token;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function triggerGithubWorkflowRefresh() {
  const token = getGithubToken();
  if (!token) throw new Error('A GitHub token is required to refresh data from the deployed site.');

  const dispatchedAt = new Date().toISOString();
  const res = await fetch(`${GH_API}/dispatches`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status === 401 || res.status === 403) {
    sessionStorage.removeItem(GH_TOKEN_KEY);
    throw new Error('GitHub rejected that token. Check its scope and try again.');
  }
  if (!res.ok) throw new Error(`Could not start the workflow (${res.status}).`);
  return dispatchedAt;
}

export async function pollGithubWorkflowRun(dispatchedAt) {
  const token = sessionStorage.getItem(GH_TOKEN_KEY);
  const res = await fetch(`${GH_API}/runs?event=workflow_dispatch&per_page=5`, { headers: githubHeaders(token) });
  if (!res.ok) throw new Error(`Could not check workflow status (${res.status}).`);
  const { workflow_runs } = await res.json();
  const run = workflow_runs.find((r) => r.created_at >= dispatchedAt) ?? null;
  if (!run) return { status: 'queued', conclusion: null, htmlUrl: null };
  return { status: run.status, conclusion: run.conclusion, htmlUrl: run.html_url };
}

function confidenceLabel(played) {
  if (played >= 15) return 'high';
  if (played >= 5) return 'medium';
  return 'low';
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function playerDetail(player, prefix) {
  return {
    id: player.id,
    name: player.name,
    rating: player[`${prefix}Rating`],
    played: player[`${prefix}Played`],
    confidence: confidenceLabel(player[`${prefix}Played`]),
  };
}

export async function simulateSingles(playerAId, playerBId) {
  const { players, singlesH2H } = await loadBundle();
  const profileA = players.find((p) => p.id === playerAId);
  const profileB = players.find((p) => p.id === playerBId);
  if (!profileA || !profileB) throw new Error('unknown player id(s)');
  if (playerAId === playerBId) throw new Error('players must be different');

  const a = playerDetail(profileA, 'singles');
  const b = playerDetail(profileB, 'singles');
  const probA = expectedScore(a.rating, b.rating);

  const h2hKey = [playerAId, playerBId].sort().join('|');
  const h2h = singlesH2H[h2hKey];

  return {
    playerA: a,
    playerB: b,
    winProbabilityA: probA,
    winProbabilityB: 1 - probA,
    headToHead: h2h ? { playerAWins: h2h[playerAId] || 0, playerBWins: h2h[playerBId] || 0 } : null,
  };
}

export async function simulateDoubles(teamA, teamB) {
  const { players, doublesPairH2H } = await loadBundle();
  if (!Array.isArray(teamA) || teamA.length !== 2 || !Array.isArray(teamB) || teamB.length !== 2) {
    throw new Error('teamA and teamB must each have exactly 2 player ids');
  }
  const allIds = [...teamA, ...teamB];
  if (new Set(allIds).size !== 4) throw new Error('all four players must be different');

  const byId = new Map(players.map((p) => [p.id, p]));
  if (allIds.some((id) => !byId.get(id))) throw new Error('unknown player id(s)');

  const teamADetail = teamA.map((id) => playerDetail(byId.get(id), 'doubles'));
  const teamBDetail = teamB.map((id) => playerDetail(byId.get(id), 'doubles'));
  const teamARating = (teamADetail[0].rating + teamADetail[1].rating) / 2;
  const teamBRating = (teamBDetail[0].rating + teamBDetail[1].rating) / 2;
  const probA = expectedScore(teamARating, teamBRating);

  const pairKeyA = [...teamA].sort().join('+');
  const pairKeyB = [...teamB].sort().join('+');
  const matchupKey = [pairKeyA, pairKeyB].sort().join('_vs_');
  const h2h = doublesPairH2H[matchupKey];

  return {
    teamA: teamADetail,
    teamB: teamBDetail,
    teamARating: Math.round(teamARating),
    teamBRating: Math.round(teamBRating),
    winProbabilityA: probA,
    winProbabilityB: 1 - probA,
    headToHead: h2h ? { teamAWins: h2h[pairKeyA] || 0, teamBWins: h2h[pairKeyB] || 0 } : null,
  };
}

// Generic version for League Day Simulator: works for any discipline prefix
// ('singles', 'doubles', 'mixed'), unlike the two match-specific helpers above
// which the single-match page's MatchupResult component depends on verbatim.
const H2H_KEY_BY_PREFIX = { singles: 'singlesH2H', doubles: 'doublesPairH2H', mixed: 'mixedPairH2H' };

export async function simulateMatch(prefix, teamA, teamB) {
  const bundle = await loadBundle();
  const idsA = Array.isArray(teamA) ? teamA : [teamA];
  const idsB = Array.isArray(teamB) ? teamB : [teamB];
  const byId = new Map(bundle.players.map((p) => [p.id, p]));
  const allIds = [...idsA, ...idsB];
  if (allIds.some((id) => !byId.get(id))) throw new Error('unknown player id(s)');
  if (new Set(allIds).size !== allIds.length) throw new Error('all players in a rubber must be different');

  const detailA = idsA.map((id) => playerDetail(byId.get(id), prefix));
  const detailB = idsB.map((id) => playerDetail(byId.get(id), prefix));
  const ratingA = detailA.reduce((sum, d) => sum + d.rating, 0) / detailA.length;
  const ratingB = detailB.reduce((sum, d) => sum + d.rating, 0) / detailB.length;
  const probA = expectedScore(ratingA, ratingB);

  let headToHead = null;
  const h2hMap = bundle[H2H_KEY_BY_PREFIX[prefix]] ?? {};
  if (idsA.length === 1) {
    const key = [idsA[0], idsB[0]].sort().join('|');
    const h2h = h2hMap[key];
    if (h2h) headToHead = { aWins: h2h[idsA[0]] || 0, bWins: h2h[idsB[0]] || 0 };
  } else {
    const pairKeyA = [...idsA].sort().join('+');
    const pairKeyB = [...idsB].sort().join('+');
    const key = [pairKeyA, pairKeyB].sort().join('_vs_');
    const h2h = h2hMap[key];
    if (h2h) headToHead = { aWins: h2h[pairKeyA] || 0, bWins: h2h[pairKeyB] || 0 };
  }

  return {
    sideA: detailA,
    sideB: detailB,
    ratingA: Math.round(ratingA),
    ratingB: Math.round(ratingB),
    winProbabilityA: probA,
    winProbabilityB: 1 - probA,
    headToHead,
  };
}
