import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTournaments, simulateTournamentMatch, tournamentWinModel } from '../api.js';
import PlayerSelect from '../components/PlayerSelect.jsx';
import RankingCard from '../components/RankingCard.jsx';
import {
  disciplineForDraw, opponentsInDraw, playerEvents, drawIsForEvent, drawFormat, defaultMockFormat, completeTeams,
  mockPoolFor, teamKey,
} from '../lib/tournamentDraws.js';
import { buildBracket, buildMockBracket, analyzeBracket } from '../lib/knockout.js';

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

// The bracket outlook with team ids replaced by names, ready to show.
async function knockoutOutlook(tournamentId, discipline, bracket, own) {
  const model = await tournamentWinModel(tournamentId, discipline);
  const outlook = analyzeBracket(bracket, own, model);
  if (!outlook) return null;
  const name = (team) => team.map(model.nameOf).join(' / ');
  return {
    titleP: outlook.titleP,
    rounds: outlook.rounds.map((round) => ({
      ...round,
      opponents: round.opponents?.map(({ team, p, winP }) => ({ name: name(team), p, winP })),
      missing: round.missing?.map(name),
    })),
  };
}

// A published draw is simulated the way it is played: a pool against everyone in
// it, a bracket round by round.
async function simulatePublishedDraw(tournamentId, { draw, format, discipline, own, opponents }) {
  const base = { draw, own };
  if (format === 'roundRobin' || format === 'doubleRoundRobin') {
    return {
      ...base,
      note: format === 'doubleRoundRobin' ? 'Home and away: each opponent is played twice.' : null,
      opponentResults: await simulateAgainst(tournamentId, discipline, own, opponents),
    };
  }
  if (format === 'knockout') {
    const bracket = buildBracket(draw);
    if (!bracket) return { ...base, note: "This bracket can't be worked out from the published draw yet." };
    const outlook = await knockoutOutlook(tournamentId, discipline, bracket, own);
    return outlook ? { ...base, outlook } : { ...base, note: 'This player is not in the published bracket.' };
  }
  return { ...base, note: `The "${draw.type}" draw format is not supported by the simulator.` };
}

const percent = (p) => `${Math.round(p * 100)}%`;
const MAX_OPPONENTS_SHOWN = 3;

// A certain opponent is just named; otherwise show how likely the meeting is.
const opponentLabel = (opponent, certain) => (certain ? `vs ${opponent.name}` : `${percent(opponent.p)} ${opponent.name}`);

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

function KnockoutRound({ round }) {
  if (round.status === 'out') return null;
  const { opponents = [] } = round;
  return (
    <div className="knockout-round">
      <h4>{round.round}</h4>
      {round.status === 'bye' && <p className="muted">Bye - through to the next round</p>}
      {round.status === 'won' && <p className="muted">Won</p>}
      {round.status === 'lost' && <p className="muted">Lost - out of the draw</p>}
      {round.status === 'unknown' && (
        <p className="error">
          Can't be simulated: {round.missing.join(', ')} {round.missing.length > 1 ? 'have' : 'has'} no national ranking data.
        </p>
      )}
      {round.status === 'upcoming' && (
        <>
          <div className="bar">
            <div className="bar-a" style={{ width: percent(round.winP) }}>{percent(round.winP)}</div>
            <div className="bar-b" style={{ width: percent(1 - round.winP) }}>{percent(1 - round.winP)}</div>
          </div>
          {round.reach < 1 && <p className="muted">{percent(round.reach)} chance of getting here</p>}
          <ul className="knockout-opponents">
            {opponents.slice(0, MAX_OPPONENTS_SHOWN).map((opponent) => (
              <li key={opponent.name}>
                {opponentLabel(opponent, opponents.length === 1)} - you win {percent(opponent.winP)}
              </li>
            ))}
            {opponents.length > MAX_OPPONENTS_SHOWN && <li className="muted">and {opponents.length - MAX_OPPONENTS_SHOWN} more possible opponents</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function KnockoutResult({ title, badge, partner, note, outlook }) {
  return (
    <div className="result">
      <h3>
        {title}
        {badge && <span className="mock-badge">{badge}</span>}
      </h3>
      {partner && <p className="muted">Playing with {partner}</p>}
      {note && <p className="muted">{note}</p>}
      {outlook.rounds.map((round) => <KnockoutRound key={round.round} round={round} />)}
      {outlook.titleP != null && <p className="knockout-title">Chance to win the draw: {percent(outlook.titleP)}</p>}
    </div>
  );
}

const MOCK_FORMATS = [
  { value: 'pools', label: 'Round-robin pools' },
  { value: 'knockout', label: 'Knockout bracket' },
];

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
  const [mockFormatChoice, setMockFormatChoice] = useState(null);
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
    setMockFormatChoice(null);
  };

  // Unless chosen, mocked draws follow how this tournament's published draws are played.
  const mockFormat = mockFormatChoice ?? defaultMockFormat(tournament);
  const changeMockFormat = (next) => {
    mockRun.current += 1;
    setMockResults([]);
    setMockLoading(false);
    setMockFormatChoice(next);
  };

  // Every published draw, in any discipline, that the selected player is in.
  // Round-robin pools need someone to play; a bracket or an unmodelled format is shown as is.
  const relevantDraws = useMemo(() => {
    if (!tournament || !playerId) return [];
    return (tournament.draws ?? [])
      .map((draw) => ({ draw, format: drawFormat(draw), discipline: disciplineForDraw(draw.name), ...opponentsInDraw(draw, playerId) }))
      .filter(({ discipline, own, format, opponents }) => discipline && own && (opponents.length > 0 || format === 'knockout' || format === null));
  }, [tournament, playerId]);

  // The player's events with no published draw they are in - what a mocked draw can stand in for.
  const undrawnEvents = useMemo(
    () => playerEvents(tournament, playerId).filter(({ event }) => !relevantDraws.some(({ draw }) => drawIsForEvent(event, draw))),
    [tournament, playerId, relevantDraws]
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
    Promise.all(relevantDraws.map((entry) => simulatePublishedDraw(tournamentId, entry)))
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
          if (teams.length < 2) return { ...base, opponentResults: [], note: 'Nobody else is registered in this event yet.' };
          const unit = discipline === 'singles' ? 'players' : 'pairs';
          const leftOut = (event.participants ?? []).length - teams.length;
          const leftOutNote = leftOut > 0 ? `; ${leftOut} without a partner left out` : '';
          const field = `${teams.length} ${unit}${leftOutNote}`;
          if (mockFormat === 'knockout') {
            const byes = 2 ** Math.ceil(Math.log2(teams.length)) - teams.length;
            const byeWord = byes === 1 ? 'bye' : 'byes';
            const byeNote = byes > 0 ? `, ${byes} ${byeWord}` : '';
            const outlook = await knockoutOutlook(tournamentId, discipline, buildMockBracket(teams), entry);
            return { ...base, outlook, note: `Random knockout bracket for ${field}${byeNote}` };
          }
          const { opponents, poolSize, poolCount } = mockPoolFor(teams, entry);
          const poolWord = poolCount === 1 ? 'pool' : 'pools';
          return {
            ...base,
            note: `Random pool of ${poolSize} (${poolCount} ${poolWord} for ${field})`,
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

      {drawResults.map(({ draw, own, note, outlook, opponentResults }) => (
        outlook
          ? <KnockoutResult key={draw.draw_id} title={draw.name} partner={partnerOf(own)} note={note} outlook={outlook} />
          : <DrawResult key={draw.draw_id} title={draw.name} partner={partnerOf(own)} note={note} opponentResults={opponentResults ?? []} />
      ))}

      {showNoDrawRow && (
        <div className="no-draw-row">
          <p className="muted">
            {relevantDraws.length === 0
              ? 'No draw data available yet'
              : `No draw data available yet for ${undrawnEvents.map(({ event }) => event.name.replace(/\s+/g, ' ')).join(', ')}`}
          </p>
          {undrawnEvents.length > 0 && (
            <>
              <label className="mock-format">
                Mocked draw format
                <select value={mockFormat} onChange={(e) => changeMockFormat(e.target.value)}>
                  {MOCK_FORMATS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="button" className="btn-outline" onClick={simulateMockedDraws} disabled={mockLoading}>
                Simulate matches with mocked draws
              </button>
            </>
          )}
        </div>
      )}

      {mockLoading && <p className="muted">Simulating…</p>}

      {mockResults.map(({ event, own, note, outlook, opponentResults }) => {
        const shared = { title: event.name.replace(/\s+/g, ' '), badge: 'Mocked draw', partner: partnerOf(own), note };
        return outlook
          ? <KnockoutResult key={event.event_id} {...shared} outlook={outlook} />
          : <DrawResult key={event.event_id} {...shared} opponentResults={opponentResults} />;
      })}
    </div>
  );
}
