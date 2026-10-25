import { useEffect } from 'react';

// If the pool's team list arrives (or changes) after a club is already picked,
// auto-select its squad only when unambiguous.
export default function useSquadAutoSelect(poolTeams, club, setTeamFilter) {
  useEffect(() => {
    if (!club) return;
    const teams = poolTeams.filter((t) => t.club === club);
    if (teams.length === 1) setTeamFilter(teams[0].squad);
  }, [poolTeams, club, setTeamFilter]);
}
