import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayers, fetchMeta, simulateSingles, simulateDoubles } from '../api.js';
import useDataRefresh from '../hooks/useDataRefresh.js';
import usePoolFetch from '../hooks/usePoolFetch.js';
import useSquadAutoSelect from '../hooks/useSquadAutoSelect.js';
import { clearMismatchedIds } from '../lib/poolUtils.js';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import PlayerSelect from '../components/PlayerSelect.jsx';
import PlayerStatsCard from '../components/PlayerStatsCard.jsx';
import RankingCard from '../components/RankingCard.jsx';
import DivisionCard from '../components/DivisionCard.jsx';
import TitlesCard from '../components/TitlesCard.jsx';
import CareerMedalsCard from '../components/CareerMedalsCard.jsx';
import ClubSelect from '../components/ClubSelect.jsx';
import MatchupResult from '../components/MatchupResult.jsx';
import SimulatorModeTabs from '../components/SimulatorModeTabs.jsx';
import PoolFetchBanner from '../components/PoolFetchBanner.jsx';
import DivisionPoolSelects from '../components/DivisionPoolSelects.jsx';
import TeamRow from '../components/TeamRow.jsx';
import TournamentMatchSimulator from './TournamentMatchSimulator.jsx';

const STORAGE_KEY = 'badminton-app-state';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTimestamp(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.sideA) && Array.isArray(parsed.sideB)) return parsed;
  } catch {
    // ignore malformed/unavailable storage
  }
  return null;
}

// When a pool roster is known, only its actual squad (plus the already-selected id) is eligible.
function filterByClub(players, clubFilter, keepId, rosterIds = null) {
  return players.filter((p) => {
    if (p.id === keepId) return true;
    if (clubFilter && p.club !== clubFilter) return false;
    return !rosterIds || rosterIds.includes(p.id);
  });
}

function SideEditor({
  label, players, ids, onChange, excludeIds, clubs, clubFilter, onClubFilterChange, titleYears,
  teamFilter, onTeamFilterChange, poolTeams = [], rosterIds = null,
}) {
  const setSlot = (idx, value) => {
    const next = [...ids];
    next[idx] = value;
    onChange(next);
  };

  return (
    <div className="team">
      <div className="team-header">
        <h4>{label}</h4>
        <ClubSelect clubs={clubs} value={clubFilter} onChange={onClubFilterChange} />
      </div>
      <TeamRow clubFilter={clubFilter} poolTeams={poolTeams} teamFilter={teamFilter} onTeamFilterChange={onTeamFilterChange} />
      {ids.map((id, idx) => {
        const selectedPlayer = players.find((p) => p.id === id);
        return (
          <div key={`${label}-slot-${idx}`} className="player-slot">
            <PlayerSelect
              label={idx === 0 ? 'Player' : 'Partner'}
              players={filterByClub(players, clubFilter, id, rosterIds)}
              value={id}
              onChange={(v) => setSlot(idx, v)}
              excludeIds={[...excludeIds, ...ids.filter((_, i) => i !== idx)]}
            />
            <div className="player-card-grid">
              <div className="grid-line" style={{ left: '20%' }} />
              <div className="grid-line" style={{ left: '43%' }} />
              <div className="grid-line" style={{ left: '66%' }} />
              <PlayerStatsCard player={selectedPlayer} />
              <RankingCard nationalRanking={selectedPlayer?.nationalRanking} />
              <DivisionCard highestDivision={selectedPlayer?.highestDivision} />
              <TitlesCard titles={selectedPlayer?.titles} />
              <CareerMedalsCard titleCounts={selectedPlayer?.titleCounts} titleYears={titleYears} />
            </div>
          </div>
        );
      })}
      {ids.length === 1 ? (
        <button type="button" className="link-btn" onClick={() => onChange([...ids, ''])}>
          + Add doubles partner
        </button>
      ) : (
        <button type="button" className="link-btn" onClick={() => onChange(ids.slice(0, 1))}>
          – Remove partner (singles)
        </button>
      )}
    </div>
  );
}

export default function MatchSimulator() {
  const stored = loadStoredState();
  const [mode, setMode] = useState(() => localStorage.getItem('badminton-app-simulator-mode') ?? 'league');
  const [players, setPlayers] = useState([]);
  const [sideA, setSideA] = useState(stored?.sideA ?? ['']);
  const [sideB, setSideB] = useState(stored?.sideB ?? ['']);
  const [division, setDivision] = useState(stored?.division ?? 'Mannen Veer 2');
  const [drawId, setDrawId] = useState(stored?.drawId ?? '');
  const [leagueIndex, setLeagueIndex] = useState({ divisions: {} });
  const [fetchedDrawIds, setFetchedDrawIds] = useState([]);
  const [poolRosters, setPoolRosters] = useState({});
  const [clubFilterA, setClubFilterA] = useState(stored?.clubFilterA ?? '');
  const [teamFilterA, setTeamFilterA] = useState(stored?.teamFilterA ?? null);
  const [clubFilterB, setClubFilterB] = useState(stored?.clubFilterB ?? '');
  const [teamFilterB, setTeamFilterB] = useState(stored?.teamFilterB ?? null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [poolLabel, setPoolLabel] = useState('');
  const { refreshState, showUnchanged, fetchData } = useDataRefresh((bundle) => {
    setPlayers(bundle.players);
    setLastUpdated(bundle.meta.lastUpdated);
    setPoolLabel(bundle.meta.poolLabel);
  }, drawId);
  const { isAdmin } = useAuth();
  const { poolFetchState, fetchPoolData } = usePoolFetch(drawId, (bundle) => {
    setPlayers(bundle.players);
    setLeagueIndex(bundle.meta.leagueIndex ?? { divisions: {} });
    setFetchedDrawIds(bundle.meta.fetchedDrawIds ?? []);
    setPoolRosters(bundle.meta.poolRosters ?? {});
  });
  const simulationRequestId = useRef(0);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const poolAfdelingen = leagueIndex.divisions[division] ?? [];
  const poolTeams = useMemo(
    () => poolAfdelingen.find((a) => a.drawId === drawId)?.teams ?? [],
    [poolAfdelingen, drawId]
  );
  const poolClubs = [...new Set(poolTeams.map((t) => t.club))].sort((a, b) => a.localeCompare(b));
  // null (not []) when this pool has no roster data yet, so filtering falls back to club-only.
  const currentPoolRosterIds = drawId ? (poolRosters[drawId] ?? null) : null;
  // Show only years with real title data for the players currently being compared,
  // so both sides share a row set without dragging in the whole pool's history.
  const selectedIds = [...sideA, ...sideB].filter(Boolean);
  const visibleTitleYears = [...new Set(
    selectedIds
      .map((id) => players.find((p) => p.id === id))
      .filter(Boolean)
      .flatMap((p) => Object.entries(p.titleCounts?.byYear ?? {}))
      .filter(([, counts]) => counts.gold + counts.silver + counts.bronze > 0)
      .map(([year]) => Number(year))
  )].sort((a, b) => a - b);

  useEffect(() => {
    fetchPlayers()
      .then(setPlayers)
      .catch((e) => setError(e.message));
    fetchMeta()
      .then((m) => {
        setLastUpdated(m.lastUpdated);
        setPoolLabel(m.poolLabel);
        setLeagueIndex(m.leagueIndex ?? { divisions: {} });
        setFetchedDrawIds(m.fetchedDrawIds ?? []);
        setPoolRosters(m.poolRosters ?? {});
        if (!stored?.drawId && m.currentPool?.drawId) setDrawId(m.currentPool.drawId);
      })
      .catch(() => {});
  }, []);

  useSquadAutoSelect(poolTeams, clubFilterA, setTeamFilterA);
  useSquadAutoSelect(poolTeams, clubFilterB, setTeamFilterB);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sideA, sideB, division, drawId, clubFilterA, teamFilterA, clubFilterB, teamFilterB })
    );
  }, [sideA, sideB, division, drawId, clubFilterA, teamFilterA, clubFilterB, teamFilterB]);

  const selected = [...sideA, ...sideB].filter(Boolean);
  const sameSize = sideA.length === sideB.length;
  const allFilled = sideA.every(Boolean) && sideB.every(Boolean);
  const noDuplicates = new Set(selected).size === selected.length;
  const canSimulate = sameSize && allFilled && noDuplicates;

  const runSimulation = async () => {
    const requestId = ++simulationRequestId.current;
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const r =
        sideA.length === 1 ? await simulateSingles(sideA[0], sideB[0]) : await simulateDoubles(sideA, sideB);
      if (simulationRequestId.current === requestId) setResult(r);
    } catch (e) {
      if (simulationRequestId.current === requestId) setError(e.message);
    } finally {
      if (simulationRequestId.current === requestId) setLoading(false);
    }
  };

  // Auto-run whenever the player/pairing composition changes; also invalidates
  // any still-in-flight simulation from the previous composition so a slow
  // response can't overwrite the result for what's selected now.
  useEffect(() => {
    simulationRequestId.current++;
    setResult(null);
    setError('');
    if (canSimulate) void runSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideA, sideB]);

  const removePartners = () => {
    setSideA((ids) => ids.slice(0, 1));
    setSideB((ids) => ids.slice(0, 1));
  };

  const clearAll = () => {
    setSideA(['']);
    setSideB(['']);
    setClubFilterA('');
    setClubFilterB('');
    localStorage.removeItem(STORAGE_KEY);
  };

  const changeDivision = (next) => {
    setDivision(next);
    setDrawId(leagueIndex.divisions[next]?.[0]?.drawId ?? '');
    setSideA(['']);
    setSideB(['']);
    setClubFilterA('');
    setTeamFilterA(null);
    setClubFilterB('');
    setTeamFilterB(null);
  };

  const changePool = (nextDrawId) => {
    setDrawId(nextDrawId);
    setSideA(['']);
    setSideB(['']);
    setClubFilterA('');
    setTeamFilterA(null);
    setClubFilterB('');
    setTeamFilterB(null);
  };

  // Dropping a club filter that no longer matches the currently selected player(s)
  // clears that slot instead of silently keeping an out-of-filter player selected. Also
  // resolves the squad: auto-picked when the club has exactly one team in this pool,
  // left for the user to pick (via the team select) when there's more than one.
  const changeClubFilter = (setIds, setFilter, setTeamFilter) => (club) => {
    setFilter(club);
    const teams = poolTeams.filter((t) => t.club === club);
    setTeamFilter(teams.length === 1 ? teams[0].squad : null);
    if (!club) return;
    setIds((ids) => clearMismatchedIds(ids, club, byId));
  };
  const handleClubFilterA = changeClubFilter(setSideA, setClubFilterA, setTeamFilterA);
  const handleClubFilterB = changeClubFilter(setSideB, setClubFilterB, setTeamFilterB);

  const changeMode = (next) => {
    setMode(next);
    localStorage.setItem('badminton-app-simulator-mode', next);
  };

  if (mode === 'tournament') {
    return (
      <div className="app">
        <PageHeader title="Match Simulator" subtitle="Tournament entrants, rated by national ranking" />
        <SimulatorModeTabs mode={mode} onChange={changeMode} />
        <TournamentMatchSimulator />
      </div>
    );
  }

  return (
    <div className="app">
      <PageHeader
        title="Match Simulator"
        subtitle={(
          <>
            {players.length} rated players from {poolLabel || 'your league pool'}
            {lastUpdated && ` · data as of ${formatTimestamp(lastUpdated)}`}
          </>
        )}
        onClearAll={clearAll}
        refreshState={refreshState}
        showUnchanged={showUnchanged}
        onFetchData={fetchData}
        isAdmin={isAdmin}
        extraActions={(
          <button type="button" className="btn-outline" onClick={removePartners}>
            Remove partners
          </button>
        )}
      />

      <SimulatorModeTabs mode={mode} onChange={changeMode} />

      <div className="league-day-controls">
        <DivisionPoolSelects
          divisions={Object.keys(leagueIndex.divisions)}
          division={division}
          onDivisionChange={changeDivision}
          poolAfdelingen={poolAfdelingen}
          drawId={drawId}
          onPoolChange={changePool}
        />
      </div>

      <PoolFetchBanner
        drawId={drawId}
        fetchedDrawIds={fetchedDrawIds}
        poolFetchState={poolFetchState}
        isAdmin={isAdmin}
        onFetch={fetchPoolData}
      />

      <div className="matchup-form doubles">
        <SideEditor
          label="Side A"
          players={players}
          ids={sideA}
          onChange={setSideA}
          excludeIds={sideB}
          clubs={poolClubs}
          clubFilter={clubFilterA}
          onClubFilterChange={handleClubFilterA}
          titleYears={visibleTitleYears}
          teamFilter={teamFilterA}
          onTeamFilterChange={setTeamFilterA}
          poolTeams={poolTeams}
          rosterIds={currentPoolRosterIds}
        />
        <span className="vs">vs</span>
        <SideEditor
          label="Side B"
          players={players}
          ids={sideB}
          onChange={setSideB}
          excludeIds={sideA}
          clubs={poolClubs}
          clubFilter={clubFilterB}
          onClubFilterChange={handleClubFilterB}
          titleYears={visibleTitleYears}
          teamFilter={teamFilterB}
          onTeamFilterChange={setTeamFilterB}
          poolTeams={poolTeams}
          rosterIds={currentPoolRosterIds}
        />
      </div>

      {!sameSize && (
        <p className="error">Both sides must have the same number of players (1 for singles, 2 for doubles).</p>
      )}

      <button className="simulate-btn" disabled={loading || !canSimulate} onClick={runSimulation}>
        {loading ? 'Simulating…' : 'Simulate Win Rate'}
      </button>

      {error && <p className="error">{error}</p>}
      <MatchupResult result={result} />
    </div>
  );
}
