import { useEffect, useMemo, useState } from 'react';
import { fetchTournaments } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import PlayerSelect from '../components/PlayerSelect.jsx';
import ProfileHeader from '../components/ProfileHeader.jsx';
import ProfileStatsCard from '../components/ProfileStatsCard.jsx';
import RankingCard from '../components/RankingCard.jsx';
import TournamentResults from '../components/TournamentResults.jsx';
import UpcomingTournaments from '../components/UpcomingTournaments.jsx';
import { buildProfiles, tournamentResults } from '../lib/profiles.js';

const STORAGE_KEY = 'badminton-app-profile-state';

function loadStoredId() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY))?.selectedId ?? '';
  } catch {
    return '';
  }
}

export default function PlayerProfiles() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState(loadStoredId);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedId }));
  }, [selectedId]);

  const profiles = useMemo(() => buildProfiles(tournaments), [tournaments]);
  const profile = profiles.find((p) => p.id === selectedId) ?? null;
  const results = useMemo(() => (profile ? tournamentResults(profile, tournaments) : []), [profile, tournaments]);

  return (
    <div className="player-profiles">
      <PageHeader title="Player profiles" subtitle="Tournament entrants, as on Badminton Nederland" onClearAll={() => setSelectedId('')} />

      <div className="league-day-controls">
        <PlayerSelect label="Player" players={profiles} value={selectedId} onChange={setSelectedId} showClub={false} />
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
