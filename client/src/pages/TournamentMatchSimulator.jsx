import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTournaments, simulateTournamentMatch } from '../api.js';
import PlayerSelect from '../components/PlayerSelect.jsx';
import RankingCard from '../components/RankingCard.jsx';
import {
  disciplineForDraw, opponentsInDraw, playerEvents, eventHasDraw, completeTeams, mockPoolFor, teamKey,
} from '../lib/tournamentDraws.js';

const STORAGE_KEY = 'badminton-app-tournament-state';

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Singles sides are a bare id, pairs an array of ids.
const asSide = (team) => (team.length === 1 ? team[0] : team);

function simulateAgainst(tournamentId, discipline, ownTeam, opponents) {
  return Promise.all(
    opponents.map(async (opponent) => ({
      opponentKey: teamKey(opponent),
      result: await simulateTournamentMatch(tournamentId, discipline, asSide(ownTeam), asSide(opponent)),
    }))
  );
}

function describeSide(side) {
  if (side.members?.length > 1) {
    const ranks = side.members.map((m) => `#${m.ranking.rank}`).join(' / ');
    return `${side.name} — ${ranks}`;
  }
  return `${side.name} — #${side.ranking.rank} (${side.ranking.points} pts)`;
}

function DrawResult({ title, badge, partner, note, opponentResults }) {
  return (
    <div className="result">
      <h3>
        {title}
        {badge && <span className="mock-badge">{badge}</span>}
      </h3>
      {partner && <p className="muted">Playing with {partner}</p>}
      {note && <p className="muted">{note}</p>}
      {opponentResults.map(({ opponentKey, result }) => (
        <div key={opponentKey} className="sides">
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
              <p className="rating">vs {describeSide(result.sideB)}</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default function TournamentMatchSimulator() {
  const stored = loadStoredState();
  const [tournaments, setTournaments] = useState([]);
  const [tournamentId, setTournamentId] = useState(stored?.tournamentId ?? '');
  const [playerId, setPlayerId] = useState(stored?.playerId ?? '');
  const [drawResults, setDrawResults] = useState([]);
  const [mockResults, setMockResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mockLoading, setMockLoading] = useState(false);
  const [error, setError] = useState('');
  const mockRun = useRef(0);

  useEffect(() => {
    fetchTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
  }, []);

  const tournament = tournaments.find((t) => t.id === tournamentId) ?? null;
  const players = tournament?.players ?? [];
  const player = players.find((p) => p.id === playerId);
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? id;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournamentId, playerId }));
  }, [tournamentId, playerId]);

  // A different tournament/player invalidates any mocked draw and its in-flight run.
  useEffect(() => {
    mockRun.current += 1;
    setMockResults([]);
    setMockLoading(false);
  }, [tournamentId, playerId]);

  const changeTournament = (nextId) => {
    setTournamentId(nextId);
    setPlayerId('');
    setDrawResults([]);
  };

  // Every published draw, in any discipline, that the selected player is in.
  const relevantDraws = useMemo(() => {
    if (!tournament || !playerId) return [];
    return (tournament.draws ?? [])
      .map((draw) => ({ draw, discipline: disciplineForDraw(draw.name), ...opponentsInDraw(draw, playerId) }))
      .filter(({ discipline, own, opponents }) => discipline && own && opponents.length > 0);
  }, [tournament, playerId]);

  // The player's events that have no published draw yet - what a mocked draw can stand in for.
  const undrawnEvents = useMemo(
    () => playerEvents(tournament, playerId).filter(({ event }) => !eventHasDraw(event, tournament.draws)),
    [tournament, playerId]
  );

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
      relevantDraws.map(async ({ draw, discipline, own, opponents }) => ({
        draw,
        own,
        opponentResults: await simulateAgainst(tournamentId, discipline, own, opponents),
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

  const simulateMockedDraws = async () => {
    const run = ++mockRun.current;
    setMockLoading(true);
    setError('');
    try {
      const results = await Promise.all(
        undrawnEvents.map(async ({ event, discipline, entry }) => {
          const base = { event, own: entry };
          if (entry.length < (discipline === 'singles' ? 1 : 2)) return { ...base, opponentResults: [], note: 'Still waiting for a partner to be registered.' };
          const teams = completeTeams(event, discipline);
          const { opponents, poolSize, poolCount } = mockPoolFor(teams, entry);
          if (opponents.length === 0) return { ...base, opponentResults: [], note: 'Nobody else is registered in this event yet.' };
          const unit = discipline === 'singles' ? 'players' : 'pairs';
          const leftOut = (event.participants ?? []).length - teams.length;
          const leftOutNote = leftOut > 0 ? `; ${leftOut} without a partner left out` : '';
          const poolWord = poolCount === 1 ? 'pool' : 'pools';
          return {
            ...base,
            note: `Random pool of ${poolSize} (${poolCount} ${poolWord} for ${teams.length} ${unit}${leftOutNote})`,
            opponentResults: await simulateAgainst(tournamentId, discipline, entry, opponents),
          };
        })
      );
      if (run === mockRun.current) setMockResults(results);
    } catch (e) {
      if (run === mockRun.current) setError(e.message);
    } finally {
      if (run === mockRun.current) setMockLoading(false);
    }
  };

  const partnerOf = (own) => (own.length > 1 ? own.filter((id) => id !== playerId).map(nameOf).join(' / ') : null);
  const showNoDrawRow = Boolean(playerId) && !loading && (relevantDraws.length === 0 || undrawnEvents.length > 0);

  return (
    <div className="tournament-simulator">
      <div className="league-day-controls">
        <PlayerSelect
          label="Tournament"
          players={tournaments}
          value={tournamentId}
          onChange={changeTournament}
          showClub={false}
          placeholder="Search tournament..."
          emptyText="No tournaments found"
          className="tournament-select"
        />
        <PlayerSelect label="Player" players={players} value={playerId} onChange={setPlayerId} showClub={false} />
      </div>

      {tournamentId && !tournament && <p className="muted">No entrants/draws scraped for this tournament yet.</p>}

      {player && (
        <div className="player-card-grid">
          <RankingCard nationalRanking={player.nationalRanking} />
        </div>
      )}

      {loading && <p className="muted">Simulating…</p>}
      {error && <p className="error">{error}</p>}

      {drawResults.map(({ draw, own, opponentResults }) => (
        <DrawResult key={draw.draw_id} title={draw.name} partner={partnerOf(own)} opponentResults={opponentResults} />
      ))}

      {showNoDrawRow && (
        <div className="no-draw-row">
          <p className="muted">
            {relevantDraws.length === 0
              ? 'No draw data available yet'
              : `No draw data available yet for ${undrawnEvents.map(({ event }) => event.name.replace(/\s+/g, ' ')).join(', ')}`}
          </p>
          {undrawnEvents.length > 0 && (
            <button type="button" className="btn-outline" onClick={simulateMockedDraws} disabled={mockLoading}>
              Simulate matches with mocked draws
            </button>
          )}
        </div>
      )}

      {mockLoading && <p className="muted">Simulating…</p>}

      {mockResults.map(({ event, own, note, opponentResults }) => (
        <DrawResult
          key={event.event_id}
          title={event.name.replace(/\s+/g, ' ')}
          badge="Mocked draw"
          partner={partnerOf(own)}
          note={note}
          opponentResults={opponentResults}
        />
      ))}
    </div>
  );
}
