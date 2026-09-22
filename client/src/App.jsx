import { useEffect, useRef, useState } from 'react';
import {
  fetchPlayers,
  fetchMeta,
  simulateSingles,
  simulateDoubles,
  triggerRefresh,
  fetchRefreshProgress,
  reloadBundle,
  triggerGithubWorkflowRefresh,
  pollGithubWorkflowRun,
} from './api.js';
import PlayerSelect from './components/PlayerSelect.jsx';
import PlayerStatsCard from './components/PlayerStatsCard.jsx';
import RankingCard from './components/RankingCard.jsx';
import DivisionCard from './components/DivisionCard.jsx';
import TitlesCard from './components/TitlesCard.jsx';
import CareerMedalsCard from './components/CareerMedalsCard.jsx';
import ClubSelect from './components/ClubSelect.jsx';
import MatchupResult from './components/MatchupResult.jsx';

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

function filterByClub(players, clubFilter, keepId) {
  if (!clubFilter) return players;
  return players.filter((p) => p.club === clubFilter || p.id === keepId);
}

function SideEditor({ label, players, ids, onChange, excludeIds, clubs, clubFilter, onClubFilterChange, titleYears }) {
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
      {ids.map((id, idx) => {
        const selectedPlayer = players.find((p) => p.id === id);
        return (
          <div key={idx} className="player-slot">
            <PlayerSelect
              label={idx === 0 ? 'Player' : 'Partner'}
              players={filterByClub(players, clubFilter, id)}
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

export default function App() {
  const stored = loadStoredState();
  const [players, setPlayers] = useState([]);
  const [sideA, setSideA] = useState(stored?.sideA ?? ['']);
  const [sideB, setSideB] = useState(stored?.sideB ?? ['']);
  const [clubFilterA, setClubFilterA] = useState(stored?.clubFilterA ?? '');
  const [clubFilterB, setClubFilterB] = useState(stored?.clubFilterB ?? '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [poolLabel, setPoolLabel] = useState('');
  const [titleYears, setTitleYears] = useState([]);
  const [refreshState, setRefreshState] = useState({ running: false, percent: 0, detail: '', error: null });
  const [showUnchanged, setShowUnchanged] = useState(false);
  const simulationRequestId = useRef(0);
  const clubs = [...new Set(players.map((p) => p.club).filter(Boolean))].sort();
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
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sideA, sideB, clubFilterA, clubFilterB }));
  }, [sideA, sideB, clubFilterA, clubFilterB]);

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

  // Dropping a club filter that no longer matches the currently selected player(s)
  // clears that slot instead of silently keeping an out-of-filter player selected.
  const changeClubFilter = (setIds, setFilter) => (club) => {
    setFilter(club);
    if (!club) return;
    setIds((ids) => ids.map((id) => {
      const p = players.find((pl) => pl.id === id);
      return p && p.club !== club ? '' : id;
    }));
  };
  const handleClubFilterA = changeClubFilter(setSideA, setClubFilterA);
  const handleClubFilterB = changeClubFilter(setSideB, setClubFilterB);

  const applyRefreshedBundle = async () => {
    const bundle = await reloadBundle();
    setPlayers(bundle.players);
    setLastUpdated(bundle.meta.lastUpdated);
    setPoolLabel(bundle.meta.poolLabel);
    setTitleYears(bundle.meta.titleYears ?? []);
  };

  // Local dev: polls server/index.js's own refresh_progress.json (see api.js).
  const fetchDataLocal = async () => {
    try {
      await triggerRefresh();
    } catch (e) {
      setRefreshState({ running: false, percent: 0, detail: '', error: e.message });
      return;
    }
    const poll = async () => {
      let progress;
      try {
        progress = await fetchRefreshProgress();
      } catch {
        setRefreshState({ running: false, percent: 0, detail: '', error: 'Lost connection to the refresh server.' });
        return;
      }
      setRefreshState({ running: progress.running, percent: progress.percent, detail: progress.detail, error: progress.error });
      if (progress.running) {
        setTimeout(poll, 1000);
        return;
      }
      if (progress.error) return;
      if (progress.unchanged) {
        setShowUnchanged(true);
        setTimeout(() => setShowUnchanged(false), 3000);
        return;
      }
      await applyRefreshedBundle();
    };
    poll();
  };

  // Production (GitHub Pages): no backend to hit, so trigger the deploy.yml
  // workflow directly via the GitHub API and poll its run status instead.
  const fetchDataGithub = async () => {
    let dispatchedAt;
    try {
      dispatchedAt = await triggerGithubWorkflowRefresh();
    } catch (e) {
      setRefreshState({ running: false, percent: 0, detail: '', error: e.message });
      return;
    }
    const poll = async () => {
      let run;
      try {
        run = await pollGithubWorkflowRun(dispatchedAt);
      } catch (e) {
        setRefreshState({ running: false, percent: 0, detail: '', error: e.message });
        return;
      }
      const running = run.status !== 'completed';
      const percent = run.status === 'completed' ? 100 : run.status === 'in_progress' ? 60 : 15;
      setRefreshState({ running, percent, detail: run.status, error: null });
      if (running) {
        setTimeout(poll, 5000);
        return;
      }
      if (run.conclusion !== 'success') {
        setRefreshState({
          running: false,
          percent: 100,
          detail: run.status,
          error: `GitHub Actions run finished with "${run.conclusion}" — check the Actions tab for details.`,
        });
        return;
      }
      await applyRefreshedBundle();
    };
    // Give GitHub a moment to register the dispatched run before the first poll.
    setTimeout(poll, 5000);
  };

  const fetchData = () => {
    setShowUnchanged(false);
    setRefreshState({ running: true, percent: 0, detail: 'starting…', error: null });
    if (import.meta.env.DEV) fetchDataLocal();
    else fetchDataGithub();
  };

  return (
    <div className="app">
      <div className="header-row">
        <div>
          <h1>Badminton Win-Rate Simulator</h1>
          <p className="subtitle">
            {players.length} rated players from {poolLabel || 'your league pool'}
            {lastUpdated && ` · data as of ${formatTimestamp(lastUpdated)}`}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn-outline" onClick={removePartners}>
            Remove partners
          </button>
          <button type="button" className="btn-outline" onClick={clearAll}>
            Clear all
          </button>
          <div className="refresh-control">
            {showUnchanged && <div className="unchanged-bubble">Data already up to date</div>}
            <button type="button" className="btn-outline" onClick={fetchData} disabled={refreshState.running}>
              {refreshState.running ? 'Fetching…' : 'Fetch data'}
            </button>
            {refreshState.running && (
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${refreshState.percent}%` }} />
                <span className="progress-bar-label">{Math.round(refreshState.percent)}%</span>
              </div>
            )}
            {refreshState.error && <p className="error">{refreshState.error}</p>}
          </div>
        </div>
      </div>

      <div className="matchup-form doubles">
        <SideEditor
          label="Side A"
          players={players}
          ids={sideA}
          onChange={setSideA}
          excludeIds={sideB}
          clubs={clubs}
          clubFilter={clubFilterA}
          onClubFilterChange={handleClubFilterA}
          titleYears={visibleTitleYears}
        />
        <span className="vs">vs</span>
        <SideEditor
          label="Side B"
          players={players}
          ids={sideB}
          onChange={setSideB}
          excludeIds={sideA}
          clubs={clubs}
          clubFilter={clubFilterB}
          onClubFilterChange={handleClubFilterB}
          titleYears={visibleTitleYears}
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
