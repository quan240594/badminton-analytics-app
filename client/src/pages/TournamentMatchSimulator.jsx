import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTournaments, simulateTournamentMatch } from '../api.js';
import PlayerSelect from '../components/PlayerSelect.jsx';
import RankingCard from '../components/RankingCard.jsx';

const STORAGE_KEY = 'badminton-app-tournament-state';

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Draw/event names use short Dutch codes (JE/ME=jongens/meisjes enkel, singles;
// D/JD/MD/GD=dubbel variants, doubles or mixed for the "gemengd" one) with no
// explicit discipline field scraped - inferred by prefix/keyword, matching the
// only 3 disciplines national ranking data actually distinguishes.
function disciplineForDraw(name) {
  if (!name) return null;
  if (/^GD\b|Gemengd/i.test(name)) return 'mixed';
  if (/^(JE|ME|HE|DE)\b|Enkel/i.test(name)) return 'singles';
  if (/^(JD|MD|HD|DD|D)\b|Dubbel/i.test(name)) return 'doubles';
  return null;
}

export default function TournamentMatchSimulator() {
  const stored = loadStoredState();
  const [tournaments, setTournaments] = useState([]);
  const [tournamentId, setTournamentId] = useState(stored?.tournamentId ?? '');
  const [drawId, setDrawId] = useState(stored?.drawId ?? '');
  const [playerAId, setPlayerAId] = useState(stored?.playerAId ?? '');
  const [playerBId, setPlayerBId] = useState(stored?.playerBId ?? '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const simulationRequestId = useRef(0);

  useEffect(() => {
    fetchTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
  }, []);

  const tournament = tournaments.find((t) => t.id === tournamentId) ?? null;
  const draws = useMemo(() => (tournament?.draws ?? []).filter((d) => disciplineForDraw(d.name)), [tournament]);
  const draw = draws.find((d) => d.draw_id === drawId) ?? null;
  const discipline = disciplineForDraw(draw?.name);
  const players = tournament?.players ?? [];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournamentId, drawId, playerAId, playerBId }));
  }, [tournamentId, drawId, playerAId, playerBId]);

  const changeTournament = (nextId) => {
    setTournamentId(nextId);
    setDrawId('');
    setPlayerAId('');
    setPlayerBId('');
    setResult(null);
  };

  const changeDraw = (nextDrawId) => {
    setDrawId(nextDrawId);
    setPlayerAId('');
    setPlayerBId('');
    setResult(null);
  };

  const canSimulate = Boolean(tournamentId && discipline && playerAId && playerBId && playerAId !== playerBId);

  useEffect(() => {
    if (!canSimulate) {
      setResult(null);
      setError('');
      return;
    }
    const requestId = ++simulationRequestId.current;
    setError('');
    setLoading(true);
    simulateTournamentMatch(tournamentId, discipline, playerAId, playerBId)
      .then((r) => {
        if (simulationRequestId.current === requestId) setResult(r);
      })
      .catch((e) => {
        if (simulationRequestId.current === requestId) setError(e.message);
      })
      .finally(() => {
        if (simulationRequestId.current === requestId) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, discipline, playerAId, playerBId]);

  const playerA = players.find((p) => p.id === playerAId);
  const playerB = players.find((p) => p.id === playerBId);

  return (
    <div className="tournament-simulator">
      <div className="league-day-controls">
        <label className="format-select">
          Tournament:{' '}
          <select value={tournamentId} onChange={(e) => changeTournament(e.target.value)}>
            <option value="" disabled>Select a tournament…</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="format-select">
          Draw:{' '}
          <select value={drawId} onChange={(e) => changeDraw(e.target.value)} disabled={!tournament}>
            <option value="" disabled>Select a draw…</option>
            {draws.map((d) => (
              <option key={d.draw_id} value={d.draw_id}>{d.name}</option>
            ))}
          </select>
        </label>
      </div>

      {tournamentId && !tournament && <p className="muted">No entrants/draws scraped for this tournament yet.</p>}

      {tournament && (
        <div className="player-card-grid">
          <PlayerSelect label="Player" players={players} value={playerAId} onChange={setPlayerAId} excludeIds={[playerBId].filter(Boolean)} />
          <PlayerSelect label="Opponent" players={players} value={playerBId} onChange={setPlayerBId} excludeIds={[playerAId].filter(Boolean)} />
          {playerA && <RankingCard nationalRanking={playerA.nationalRanking} />}
          {playerB && <RankingCard nationalRanking={playerB.nationalRanking} />}
        </div>
      )}

      {loading && <p className="muted">Simulating…</p>}
      {error && <p className="error">{error}</p>}

      {result?.error && (
        <p className="error">{result.message}</p>
      )}

      {result && !result.error && (
        <div className="result">
          <div className="bar">
            <div className="bar-a" style={{ width: `${Math.round(result.winProbabilityA * 100)}%` }}>
              {Math.round(result.winProbabilityA * 100)}%
            </div>
            <div className="bar-b" style={{ width: `${Math.round(result.winProbabilityB * 100)}%` }}>
              {Math.round(result.winProbabilityB * 100)}%
            </div>
          </div>
          <div className="sides">
            <div className="side">
              <h3>{result.sideA.name}</h3>
              <p className="rating">Rank #{result.sideA.ranking.rank} ({result.sideA.ranking.points} pts)</p>
            </div>
            <div className="side">
              <h3>{result.sideB.name}</h3>
              <p className="rating">Rank #{result.sideB.ranking.rank} ({result.sideB.ranking.points} pts)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
