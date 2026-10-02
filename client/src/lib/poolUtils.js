export const LOST_CONNECTION_MESSAGE = 'Lost connection to the refresh server.';

export function percentForRunStatus(status) {
  if (status === 'completed') return 100;
  if (status === 'in_progress') return 60;
  return 15;
}

export function githubRunFailureMessage(conclusion) {
  return `GitHub Actions run finished with "${conclusion}" — check the Actions tab for details.`;
}

export function afdelingNumber(label) {
  const m = /afd\.\s*(\d+)/i.exec(label || '');
  return m ? Number(m[1]) : 0;
}

// Real competitive ranking, not alphabetical: Eredivisie is the top tier, then
// the numbered ladder (1e divisie highest, matching divisionRank in server/lib/dataset.js).
// Non-ladder categories (Mannen Veer/Nylon etc.) have no rank and sort after, alphabetically.
export function divisionRank(division) {
  if (/^Eredivisie$/i.test(division || '')) return 0;
  const m = /^(\d+)e\s+divisie/i.exec(division || '');
  return m ? Number(m[1]) : Infinity;
}

// "Mannen Veer 2 afd. 12" + division "Mannen Veer 2" -> "Afd. 12".
export function poolLabelSuffix(label, division) {
  const suffix = label.startsWith(division) ? label.slice(division.length).trim() : label;
  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

// Clears an id from a slot if its player's club no longer matches the filter.
export function clearIdIfClubMismatch(id, club, byId) {
  const p = byId.get(id);
  return p && p.club !== club ? '' : id;
}

export function clearMismatchedIds(ids, club, byId) {
  return ids.map((id) => clearIdIfClubMismatch(id, club, byId));
}
