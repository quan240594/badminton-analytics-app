// Squad picker for a club filter: a select when the club has several teams in the pool,
// a plain label when it has one; hidden when there is nothing to show.
export default function TeamRow({ clubFilter, poolTeams, teamFilter, onTeamFilterChange }) {
  const teams = clubFilter ? poolTeams.filter((t) => t.club === clubFilter) : [];
  if (!clubFilter || (teams.length <= 1 && !teamFilter)) return null;
  return (
    <div className="league-day-team-row">
      <span className="league-day-team-label">Team</span>
      {teams.length > 1 ? (
        <select className="team-select" value={teamFilter ?? ''} onChange={(e) => onTeamFilterChange(e.target.value)}>
          <option value="" disabled>Team…</option>
          {teams.map((t) => <option key={t.squad} value={t.squad}>{t.squad}</option>)}
        </select>
      ) : (
        <span className="team-label">{teamFilter}</span>
      )}
    </div>
  );
}
