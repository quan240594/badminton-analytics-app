export const profileUrl = (guid) => `https://badmintonnederland.toernooi.nl/player-profile/${guid}`;

// "45–22 (67%)"; a record without any match has no percentage.
export function formatRecord(record) {
  if (!record) return '-';
  const played = record.wins + record.losses;
  if (played === 0) return `${record.wins}–${record.losses}`;
  return `${record.wins}–${record.losses} (${Math.round((record.wins / played) * 100)}%)`;
}

// "Career 45–22 (67%) · This year 34–15 (69%)" for one discipline's statistics, or '' without any.
export function recordSummary(stats) {
  return [stats?.career && `Career ${formatRecord(stats.career)}`, stats?.thisYear && `This year ${formatRecord(stats.thisYear)}`]
    .filter(Boolean)
    .join(' · ');
}
