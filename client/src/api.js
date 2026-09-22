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
