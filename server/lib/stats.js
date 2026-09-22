function emptyStat() {
  return { played: 0, won: 0, setsPlayed: 0, setsWon: 0, pointsPlayed: 0, pointsWon: 0 };
}

// Score strings look like "21-14 18-21 21-19" (one "home-away" token per set).
// Non-numeric tokens (e.g. "Retired", stray scraped text) are silently skipped.
function parseSets(score) {
  if (!score) return [];
  const sets = [];
  for (const token of score.split(/\s+/)) {
    const m = /^(\d+)-(\d+)$/.exec(token.trim());
    if (m) sets.push([Number(m[1]), Number(m[2])]);
  }
  return sets;
}

// Participation-based counts (unlike Elo's "played", these don't require the opponent
// to also resolve to a tracked guid) — needed for accurate mixed-doubles totals, since
// mixed partners are almost never among an all-one-gender league pool.
export function computeCareerStats(matches) {
  const stats = new Map();

  function bucketFor(guid, discipline) {
    if (!stats.has(guid)) {
      stats.set(guid, { singles: emptyStat(), doubles: emptyStat(), mixed: emptyStat() });
    }
    return stats.get(guid)[discipline];
  }

  for (const match of matches) {
    const { discipline, home, away, winnerSide, score } = match;
    if (discipline !== 'singles' && discipline !== 'doubles' && discipline !== 'mixed') continue;
    const sets = parseSets(score);
    const sides = [
      { roster: home, won: winnerSide === 'home', isHome: true },
      { roster: away, won: winnerSide === 'away', isHome: false },
    ];
    for (const side of sides) {
      for (const p of side.roster) {
        if (!p.guid) continue;
        const bucket = bucketFor(p.guid, discipline);
        bucket.played += 1;
        if (side.won) bucket.won += 1;
        for (const [homePts, awayPts] of sets) {
          const ownPts = side.isHome ? homePts : awayPts;
          const oppPts = side.isHome ? awayPts : homePts;
          bucket.setsPlayed += 1;
          if (ownPts > oppPts) bucket.setsWon += 1;
          bucket.pointsPlayed += ownPts + oppPts;
          bucket.pointsWon += ownPts;
        }
      }
    }
  }

  return stats;
}
