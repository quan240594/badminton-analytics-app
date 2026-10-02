// Player-summary and pool-meta building shared by the live API (index.js) and the
// static bundle generator (build-static.js), so both emit the same per-player fields.
import { currentSeasonLabel } from './season.js';
import { nationalRankingFor } from './nationalRanking.js';
import { fullLeagueIndex, currentPoolTeams, fetchedDrawIds, poolRosters, substitutePlayerIds, playerGenders } from './leagueIndex.js';

export const CURRENT_POOL_LABEL = `Bondscompetitie ${currentSeasonLabel()} \u2013 Mannen Veer 2 afd. 12`;
const CURRENT_TOURNAMENT_ID = '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E';
const DISCIPLINES = ['singles', 'doubles', 'mixed'];
const EMPTY_CAREER = { played: 0, won: 0, setsPlayed: 0, setsWon: 0, pointsPlayed: 0, pointsWon: 0 };

export function confidenceLabel(played) {
  if (played >= 15) return 'high';
  if (played >= 5) return 'medium';
  return 'low';
}

export function winRate(won, played) {
  return played > 0 ? won / played : null;
}

export function careerBucket(careerStats, guid, discipline) {
  return careerStats.get(guid)?.[discipline] ?? EMPTY_CAREER;
}

export function disciplineFields(prefix, rating, career) {
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

// ctx carries the loaded dataset + computed ratings; withConfidence adds the
// per-discipline *Confidence labels only the static bundle exposes.
export function playerSummary(ctx, guid, { withConfidence = false } = {}) {
  const profile = ctx.players.get(guid);
  if (!profile) return null;
  const ratings = {
    singles: ctx.singles.get(guid),
    doubles: ctx.doublesPlayer.get(guid),
    mixed: ctx.mixedPlayer.get(guid),
  };
  const summary = {
    id: guid,
    name: profile.name,
    club: profile.club,
    ...disciplineFields('singles', ratings.singles?.rating, careerBucket(ctx.careerStats, guid, 'singles')),
    ...disciplineFields('doubles', ratings.doubles?.rating, careerBucket(ctx.careerStats, guid, 'doubles')),
    ...disciplineFields('mixed', ratings.mixed?.rating, careerBucket(ctx.careerStats, guid, 'mixed')),
    nationalRanking: nationalRankingFor(ctx.rankings.get(guid), ctx.rankingTop),
    highestDivision: ctx.highestDivisionPlayed(ctx.matches, guid),
    titles: ctx.titlesForPlayer(guid),
    titleCounts: ctx.titleCounts(guid),
  };
  if (withConfidence) {
    for (const discipline of DISCIPLINES) {
      summary[`${discipline}Confidence`] = confidenceLabel(ratings[discipline]?.played ?? 0);
    }
  }
  return summary;
}

// Historical event pages where profile-GUID parsing failed left inert 0-match
// placeholders in career.json - filtered out, unless the profile is a genuine
// current-season roster member (has a current-tournament alias even with 0
// matches), since a player who's registered but hasn't played yet is real data.
export function listPlayerSummaries(ctx, aliasIndex, options) {
  const currentSeasonGuids = new Set();
  for (const [key, guid] of aliasIndex) {
    if (key.startsWith(`${CURRENT_TOURNAMENT_ID}:`)) currentSeasonGuids.add(guid);
  }
  return [...ctx.players.keys()]
    .map((guid) => playerSummary(ctx, guid, options))
    .filter((p) => p && (p.singlesPlayed > 0 || p.doublesPlayed > 0 || p.mixedPlayed > 0 || currentSeasonGuids.has(p.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function poolMeta(aliasIndex, titleYears) {
  const currentPool = currentPoolTeams(CURRENT_POOL_LABEL);
  return {
    poolLabel: CURRENT_POOL_LABEL,
    titleYears,
    currentPool,
    leagueIndex: fullLeagueIndex(),
    fetchedDrawIds: fetchedDrawIds(currentPool.drawId),
    poolRosters: poolRosters(aliasIndex),
    substitutePlayerIds: substitutePlayerIds(aliasIndex),
    playerGenders: playerGenders(aliasIndex),
  };
}
