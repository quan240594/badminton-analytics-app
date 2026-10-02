const DISCIPLINES = ['singles', 'doubles', 'mixed'];

// byDiscipline: one player's {singles, doubles, mixed} ranking entries (or undefined);
// top: the #1 entry per discipline, used to express the player's points as a share of it.
export function nationalRankingFor(byDiscipline, top) {
  const result = {};
  for (const discipline of DISCIPLINES) {
    const entry = byDiscipline?.[discipline];
    const topEntry = top?.[discipline];
    result[discipline] = entry
      ? {
          rank: entry.rank,
          points: entry.points,
          topPoints: topEntry?.points ?? null,
          topName: topEntry?.name ?? null,
          pctOfTop: topEntry?.points ? entry.points / topEntry.points : null,
        }
      : null;
  }
  return result;
}
