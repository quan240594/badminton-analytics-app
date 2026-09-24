import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPlayers,
  fetchMeta,
  simulateSingles,
  simulateDoubles,
  triggerPoolRefresh,
  fetchPoolRefreshProgress,
  triggerGithubWorkflowPoolRefresh,
  pollGithubWorkflowRun,
  reloadBundle,
} from '../api.js';
import useDataRefresh from '../hooks/useDataRefresh.js';
import PageHeader from '../components/PageHeader.jsx';
import PlayerSelect from '../components/PlayerSelect.jsx';
import PlayerStatsCard from '../components/PlayerStatsCard.jsx';
import RankingCard from '../components/RankingCard.jsx';
import DivisionCard from '../components/DivisionCard.jsx';
import TitlesCard from '../components/TitlesCard.jsx';
import CareerMedalsCard from '../components/CareerMedalsCard.jsx';
import ClubSelect from '../components/ClubSelect.jsx';
import MatchupResult from '../components/MatchupResult.jsx';

const STORAGE_KEY = 'badminton-app-state';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTimestamp(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function afdelingNumber(label) {
  const m = /afd\.\s*(\d+)/i.exec(label || '');
  return m ? Number(m[1]) : 0;
}

// Real competitive ranking, not alphabetical: Eredivisie is the top tier, then
// the numbered ladder (1e divisie highest, matching divisionRank in server/lib/dataset.js).
// Non-ladder categories (Mannen Veer/Nylon etc.) have no rank and sort after, alphabetically.
function divisionRank(division) {
  if (/^Eredivisie$/i.test(division || '')) return 0;
  const m = /^(\d+)e\s+divisie/i.exec(division || '');
  return m ? Number(m[1]) : Infinity;
}

// "Mannen Veer 2 afd. 12" + division "Mannen Veer 2" -> "Afd. 12".
function poolLabelSuffix(label, division) {
  const suffix = label.startsWith(division) ? label.slice(division.length).trim() : label;
  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
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
  const teams = clubFilter ? poolTeams.filter((t) => t.club === clubFilter) : [];

  return (
    <div className="team">
      <div className="team-header">
        <h4>{label}</h4>
        <ClubSelect clubs={clubs} value={clubFilter} onChange={onClubFilterChange} />
      </div>
      {clubFilter && (teams.length > 1 || teamFilter) && (
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
      )}
      {ids.map((id, idx) => {
        const selectedPlayer = players.find((p) => p.id === id);
        return (
          <div key={idx} className="player-slot">
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
  const [players, setPlayers] = useState([]);
  const [sideA, setSideA] = useState(stored?.sideA ?? ['']);
  const [sideB, setSideB] = useState(stored?.sideB ?? ['']);
  const [division, setDivision] = useState(stored?.division ?? 'Mannen Veer 2');
  const [drawId, setDrawId] = useState(stored?.drawId ?? '');
  const [leagueIndex, setLeagueIndex] = useState({ divisions: {} });
  const [fetchedDrawIds, setFetchedDrawIds] = useState([]);
  const [poolRosters, setPoolRosters] = useState({});
  const [poolFetchState, setPoolFetchState] = useState({ running: false, percent: 0, error: null });
  const [clubFilterA, setClubFilterA] = useState(stored?.clubFilterA ?? '');
  const [teamFilterA, setTeamFilterA] = useState(stored?.teamFilterA ?? null);
  const [clubFilterB, setClubFilterB] = useState(stored?.clubFilterB ?? '');
  const [teamFilterB, setTeamFilterB] = useState(stored?.teamFilterB ?? null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [poolLabel, setPoolLabel] = useState('');
  const [titleYears, setTitleYears] = useState([]);
  const { refreshState, showUnchanged, fetchData } = useDataRefresh((bundle) => {
    setPlayers(bundle.players);
    setLastUpdated(bundle.meta.lastUpdated);
    setPoolLabel(bundle.meta.poolLabel);
    setTitleYears(bundle.meta.titleYears ?? []);
  });
  const simulationRequestId = useRef(0);
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
        setTitleYears(m.titleYears ?? []);
        setLeagueIndex(m.leagueIndex ?? { divisions: {} });
        setFetchedDrawIds(m.fetchedDrawIds ?? []);
        setPoolRosters(m.poolRosters ?? {});
        if (!stored?.drawId && m.currentPool?.drawId) setDrawId(m.currentPool.drawId);
      })
      .catch(() => {});
  }, []);

  // If the pool's team list arrives (or changes) after a club is already picked,
  // auto-select its squad only when unambiguous - same rule as changeClubFilter below.
  useEffect(() => {
    if (!clubFilterA) return;
    const teams = poolTeams.filter((t) => t.club === clubFilterA);
    if (teams.length === 1) setTeamFilterA(teams[0].squad);
  }, [poolTeams, clubFilterA]);
  useEffect(() => {
    if (!clubFilterB) return;
    const teams = poolTeams.filter((t) => t.club === clubFilterB);
    if (teams.length === 1) setTeamFilterB(teams[0].squad);
  }, [poolTeams, clubFilterB]);

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
    if (canSimulate) runSimulation();
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

  // Scoped alternative to "Fetch data": only pulls this one pool's players/matches
  // (fetch_pool.py), so picking an uncached pool doesn't pay for a full refresh.
  const fetchPoolData = async () => {
    if (!drawId) return;
    setPoolFetchState({ running: true, percent: 0, error: null });
    const applyRefreshedPool = async () => {
      const bundle = await reloadBundle();
      setPlayers(bundle.players);
      setLeagueIndex(bundle.meta.leagueIndex ?? { divisions: {} });
      setFetchedDrawIds(bundle.meta.fetchedDrawIds ?? []);
      setPoolRosters(bundle.meta.poolRosters ?? {});
    };
    if (import.meta.env.DEV) {
      try {
        await triggerPoolRefresh(drawId);
      } catch (e) {
        setPoolFetchState({ running: false, percent: 0, error: e.message });
        return;
      }
      const poll = async () => {
        let progress;
        try {
          progress = await fetchPoolRefreshProgress();
        } catch {
          setPoolFetchState({ running: false, percent: 0, error: 'Lost connection to the refresh server.' });
          return;
        }
        setPoolFetchState({ running: progress.running, percent: progress.percent, error: progress.error });
        if (progress.running) {
          setTimeout(poll, 1000);
          return;
        }
        if (progress.error) return;
        await applyRefreshedPool();
      };
      poll();
      return;
    }
    // Production (GitHub Pages): no local server, so dispatch deploy.yml with draw_id and poll its run.
    let dispatchedAt;
    try {
      dispatchedAt = await triggerGithubWorkflowPoolRefresh(drawId);
    } catch (e) {
      setPoolFetchState({ running: false, percent: 0, error: e.message });
      return;
    }
    const poll = async () => {
      let run;
      try {
        run = await pollGithubWorkflowRun(dispatchedAt);
      } catch (e) {
        setPoolFetchState({ running: false, percent: 0, error: e.message });
        return;
      }
      const running = run.status !== 'completed';
      const percent = run.status === 'completed' ? 100 : run.status === 'in_progress' ? 60 : 15;
      setPoolFetchState({ running, percent, error: null });
      if (running) {
        setTimeout(poll, 5000);
        return;
      }
      if (run.conclusion !== 'success') {
        setPoolFetchState({
          running: false,
          percent: 100,
          error: `GitHub Actions run finished with "${run.conclusion}" — check the Actions tab for details.`,
        });
        return;
      }
      await applyRefreshedPool();
    };
    // Give GitHub a moment to register the dispatched run before the first poll.
    setTimeout(poll, 5000);
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
    setIds((ids) => ids.map((id) => {
      const p = players.find((pl) => pl.id === id);
      return p && p.club !== club ? '' : id;
    }));
  };
  const handleClubFilterA = changeClubFilter(setSideA, setClubFilterA, setTeamFilterA);
  const handleClubFilterB = changeClubFilter(setSideB, setClubFilterB, setTeamFilterB);

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
        extraActions={(
          <button type="button" className="btn-outline" onClick={removePartners}>
            Remove partners
          </button>
        )}
      />

      <div className="league-day-controls">
        <label className="format-select">
          Division:
          <select value={division} onChange={(e) => changeDivision(e.target.value)}>
            {Object.keys(leagueIndex.divisions).sort((a, b) => divisionRank(a) - divisionRank(b) || a.localeCompare(b)).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="format-select">
          Pool:
          <select value={drawId} onChange={(e) => changePool(e.target.value)} disabled={poolAfdelingen.length === 0}>
            {[...poolAfdelingen]
              .sort((a, b) => afdelingNumber(a.label) - afdelingNumber(b.label))
              .map((a) => (
                <option key={a.drawId} value={a.drawId}>{poolLabelSuffix(a.label, division)}</option>
              ))}
          </select>
        </label>
      </div>

      {drawId && !fetchedDrawIds.includes(String(drawId)) && (
        <div className="pool-fetch-banner">
          {poolFetchState.running ? (
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${poolFetchState.percent}%` }} />
              <span className="progress-bar-label">{Math.round(poolFetchState.percent)}%</span>
            </div>
          ) : (
            <>
              <span>No data cached yet for this pool.</span>
              <button type="button" className="btn-outline" onClick={fetchPoolData}>
                Fetch pool data
              </button>
            </>
          )}
          {poolFetchState.error && <p className="error">{poolFetchState.error}</p>}
        </div>
      )}

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
