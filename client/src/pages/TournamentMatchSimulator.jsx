import { useEffect, useMemo, useState } from 'react';
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

// Every other entrant sharing a draw with the given player - from standings
// when present (pools always list the full field there), otherwise from
// actual match participants (knockout draws may not expose standings rows).
function opponentsInDraw(draw, playerId) {
  const ids = new Set();
  for (const row of draw.standings ?? []) {
    for (const p of row.players) ids.add(p.player_id);
  }
  for (const match of draw.matches ?? []) {
    for (const side of match.sides ?? []) {
      for (const p of side.players ?? []) ids.add(p.player_id);
    }
  }
  // Player never entered this draw at all - nothing to simulate, not "everyone".
  if (!ids.has(playerId)) return new Set();
  ids.delete(playerId);
  return ids;
}

export default function TournamentMatchSimulator() {
  const stored = loadStoredState();
  const [tournaments, setTournaments] = useState([]);
  const [tournamentId, setTournamentId] = useState(stored?.tournamentId ?? '');
  const [playerId, setPlayerId] = useState(stored?.playerId ?? '');
  const [drawResults, setDrawResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
  }, []);

  const tournament = tournaments.find((t) => t.id === tournamentId) ?? null;
  const players = tournament?.players ?? [];
  const player = players.find((p) => p.id === playerId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournamentId, playerId }));
  }, [tournamentId, playerId]);

  const changeTournament = (nextId) => {
    setTournamentId(nextId);
    setPlayerId('');
    setDrawResults([]);
  };

  // Every draw in this tournament the selected player actually appears in.
  const relevantDraws = useMemo(() => {
    if (!tournament || !playerId) return [];
    return (tournament.draws ?? [])
      .map((draw) => ({ draw, discipline: disciplineForDraw(draw.name), opponents: opponentsInDraw(draw, playerId) }))
      .filter(({ discipline, opponents }) => discipline && opponents.size > 0);
  }, [tournament, playerId]);

  useEffect(() => {
    if (relevantDraws.length === 0) {
      setDrawResults([]);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all(
      relevantDraws.map(async ({ draw, discipline, opponents }) => ({
        draw,
        opponentResults: await Promise.all(
          [...opponents].map(async (opponentId) => ({
            opponentId,
            opponent: players.find((p) => p.id === opponentId),
            result: await simulateTournamentMatch(tournamentId, discipline, playerId, opponentId),
          }))
        ),
      }))
    )
      .then((results) => {
        if (!cancelled) setDrawResults(results);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, playerId, relevantDraws]);

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
        <PlayerSelect label="Player" players={players} value={playerId} onChange={setPlayerId} />
      </div>

      {tournamentId && !tournament && <p className="muted">No entrants/draws scraped for this tournament yet.</p>}

      {player && (
        <div className="player-card-grid">
          <RankingCard nationalRanking={player.nationalRanking} />
        </div>
      )}

      {loading && <p className="muted">Simulating…</p>}
      {error && <p className="error">{error}</p>}

      {playerId && !loading && relevantDraws.length === 0 && (
        <p className="muted">This player isn't in any scraped draw for this tournament yet.</p>
      )}

      {drawResults.map(({ draw, opponentResults }) => (
        <div key={draw.draw_id} className="result">
          <h3>{draw.name}</h3>
          {opponentResults.map(({ opponentId, opponent, result }) => (
            <div key={opponentId} className="sides">
              {result.error ? (
                <p className="error">{result.message}</p>
              ) : (
                <>
                  <div className="bar">
                    <div className="bar-a" style={{ width: `${Math.round(result.winProbabilityA * 100)}%` }}>
                      {Math.round(result.winProbabilityA * 100)}%
                    </div>
                    <div className="bar-b" style={{ width: `${Math.round(result.winProbabilityB * 100)}%` }}>
                      {Math.round(result.winProbabilityB * 100)}%
                    </div>
                  </div>
                  <p className="rating">
                    vs {result.sideB.name} — #{result.sideB.ranking.rank} ({result.sideB.ranking.points} pts)
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
