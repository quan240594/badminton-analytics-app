import { useEffect, useMemo, useState } from 'react';
import { fetchNationalPlayers, fetchTournaments } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import PlayerSelect from '../components/PlayerSelect.jsx';
import ProfileHeader from '../components/ProfileHeader.jsx';
import ProfileStatsCard from '../components/ProfileStatsCard.jsx';
import RankingCard from '../components/RankingCard.jsx';
import TournamentResults from '../components/TournamentResults.jsx';
import UpcomingTournaments from '../components/UpcomingTournaments.jsx';
import { buildProfiles, displayName, tournamentResults } from '../lib/profiles.js';

const STORAGE_KEY = 'badminton-app-profile-state';
// The picker would otherwise render every one of ~10,000 names at once.
const MAX_OPTIONS = 50;

function loadStoredId() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY))?.selectedId ?? '';
  } catch {
    return '';
  }
}

export default function PlayerProfiles() {
  const [tournaments, setTournaments] = useState([]);
  const [nationalPlayers, setNationalPlayers] = useState([]);
  const [selectedId, setSelectedId] = useState(loadStoredId);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
    // Without the national lists the page still works, it just knows fewer players.
    fetchNationalPlayers()
      .then(setNationalPlayers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedId }));
  }, [selectedId]);

  const profiles = useMemo(() => buildProfiles(tournaments, nationalPlayers), [tournaments, nationalPlayers]);
  const options = useMemo(() => profiles.map((p) => ({ id: p.id, name: displayName(p.name) })), [profiles]);
  const profile = profiles.find((p) => p.id === selectedId) ?? null;
  const results = useMemo(() => (profile ? tournamentResults(profile, tournaments) : []), [profile, tournaments]);

  return (
    <div className="app player-profiles">
      <PageHeader title="Player profiles" subtitle="Everyone on the national ranking lists and in tournaments, as on Badminton Nederland" onClearAll={() => setSelectedId('')} />

      <div className="league-day-controls">
        <PlayerSelect label="Player" players={options} value={selectedId} onChange={setSelectedId} showClub={false} maxOptions={MAX_OPTIONS} />
      </div>

      {error && <p className="error">{error}</p>}

      {profile && (
        <>
          <ProfileHeader name={profile.name} memberId={profile.memberId} country={profile.country} />
          <div className="player-card-grid">
            <RankingCard nationalRanking={profile.nationalRanking} />
            <ProfileStatsCard profile={profile.profile} />
            <p className="profile-row"><PlayerLink name="View profile on Badminton Nederland" url={profile.url} /></p>
            <UpcomingTournaments entries={profile.tournaments} tournaments={tournaments} title={`${profile.name}: upcoming tournaments`} />
          </div>
          <TournamentResults results={results} />
        </>
      )}
    </div>
  );
}
