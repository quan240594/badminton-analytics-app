import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTournaments, simulateTournamentMatch, tournamentWinModel } from '../api.js';
import PlayerSelect from '../components/PlayerSelect.jsx';
import PlayerLink, { SideNames } from '../components/PlayerLink.jsx';
import ProfileStatsCard from '../components/ProfileStatsCard.jsx';
import UpcomingTournaments from '../components/UpcomingTournaments.jsx';
import RankingCard from '../components/RankingCard.jsx';
import { recordSummary } from '../lib/profile.js';
import {
  disciplineForDraw, opponentsInDraw, playerEvents, drawIsForEvent, drawFormat, defaultMockFormat, completeTeams,
  mockPoolFor, teamKey,
} from '../lib/tournamentDraws.js';
import { buildBracket, buildMockBracket, analyzeBracket, describeBracket } from '../lib/knockout.js';
import { analyzePool, poolGroup } from '../lib/poolOutlook.js';
import PlayoffBracket from '../components/PlayoffBracket.jsx';

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
    tree: describeBracket(bracket, own, model),
    ownKey: teamKey(own),
    rounds: outlook.rounds.map((round) => ({
      ...round,
      opponents: round.opponents?.map(({ team, p, winP }) => ({ name: name(team), team, p, winP })),
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

function qualifiedPool(forecasts, { group, rank }) {
  const pool = forecasts.find((candidate) => poolGroup(candidate.draw) === group);
  if (!pool || rank < 1 || rank > pool.teams.length) return null;
  const entries = pool.byRank?.[rank - 1];
  return { label: `Groep ${group} #${rank}`, poolTeams: pool.teams, entries: entries ? new Map([...entries].filter(([, value]) => value.p > 0)) : null };
}

function eventPlayoff(playoff, forecasts, ownPool, entry, model) {
  const ownKey = teamKey(entry);
  const published = buildBracket(playoff, (qualifier) => qualifiedPool(forecasts, qualifier));
  const tree = published ? describeBracket(published, entry, model) : null;
  const ownSlots = playoff.matches.flatMap((match) => match.sides)
    .filter((side) => side.qualifier?.group === poolGroup(ownPool.draw));
  if (ownSlots.length !== 1) return { qualification: null, outlook: null, tree,
    note: ownSlots.length > 1 ? 'Multiple qualifying positions: playoff progression is not yet modelled.' : 'Waiting for group qualifiers in the playoff draw.' };
  const rank = ownSlots[0].qualifier.rank;
  const qualification = ownPool.byRank?.[rank - 1]?.get(ownKey)?.p ?? null;
  const bracket = buildBracket(playoff, ({ group, rank: position }) => {
    if (group === poolGroup(ownPool.draw)) return { team: entry };
    return qualifiedPool(forecasts, { group, rank: position });
  });
  const result = bracket && analyzeBracket(bracket, entry, model, qualification);
  const outlook = result ? {
    ...result,
    rounds: result.rounds.map((round) => ({
      ...round,
      opponents: round.opponents?.map((opponent) => ({ ...opponent, name: opponent.team.map(model.nameOf).join(' / ') })),
      missing: round.missing ? [...new Set([
        ...round.missing,
        ...(qualification == null ? ownPool.teams.filter((team) => !model.isRated(team)) : []),
      ].map((team) => team.map(model.nameOf).join(' / ')))] : undefined,
    })),
  } : null;
  return { qualification, outlook, tree, note: outlook ? null : 'Playoff feeder data is incomplete.' };
}

async function simulateEvent(tournamentId, { event, discipline, entry }, draws) {
  const related = draws.filter((draw) => drawIsForEvent(event, draw));
  const pools = related.filter((draw) => ['roundRobin', 'doubleRoundRobin'].includes(drawFormat(draw)));
  if (!pools.length) return null;
  const model = await tournamentWinModel(tournamentId, discipline);
  const forecasts = pools.map((draw) => {
    const forecast = analyzePool(draw, model);
    const matchups = forecast.teams.map((team) => forecast.teams.map((opponent) => (
      teamKey(team) === teamKey(opponent) ? null : model.winProbability(team, opponent)
    )));
    return { draw, ...forecast, matchups };
  });
  const ownKey = teamKey(entry);
  const ownPool = forecasts.find((pool) => pool.teams.some((team) => teamKey(team) === ownKey));
  if (!ownPool) return null;
  const ownIndex = ownPool.teams.findIndex((team) => teamKey(team) === ownKey);
  const playoff = related.find((draw) => drawFormat(draw) === 'knockout');
  const progression = playoff ? eventPlayoff(playoff, forecasts, ownPool, entry, model)
    : { qualification: null, outlook: null, note: 'Playoff draw not available yet.' };
  return { event, forecasts, ownKey, sweepP: ownPool.sweep?.[ownIndex] ?? null, ...progression };
}

function EventResult({ result, memberOf }) {
  const { event, forecasts, ownKey, sweepP, qualification, outlook, tree, note } = result;
  return <div className="result tournament-outlook">
    <h3>{event.name}: tournament outlook</h3>
    <p className="muted">Tied match-win totals share finishing positions equally in this forecast; game and point tiebreaks are not predicted.</p>
    {sweepP != null && <p>Win every group match: {percent(sweepP)}</p>}
    {qualification != null && <p>Advance from the group: {percent(qualification)}</p>}
    {forecasts.map((pool) => <section key={pool.draw.draw_id} className={pool.teams.some((team) => teamKey(team) === ownKey) ? 'selected-player-pool' : undefined}>
      <h4>{pool.draw.name}</h4>
      <div className="table-scroll">
        <table className="pool-matchup-table" style={{ minWidth: `${12 + (pool.teams.length + 1) * 7}rem` }} aria-label={`${pool.draw.name} match probabilities`}>
          <colgroup><col style={{ width: '12rem' }} />{pool.teams.map((team) => <col key={teamKey(team)} style={{ width: '7rem' }} />)}<col style={{ width: '7rem' }} /></colgroup>
          <thead><tr><th scope="col">Player / Pair</th>
            {pool.teams.map((team) => <th scope="col" key={teamKey(team)}><SideNames members={team.map(memberOf)} /></th>)}
            <th scope="col">Finish First</th>
          </tr></thead>
          <tbody>{pool.teams.map((team, row) => <tr key={teamKey(team)} className={teamKey(team) === ownKey ? 'selected-team' : undefined}>
            <th scope="row"><SideNames members={team.map(memberOf)} /></th>
            {pool.teams.map((opponent, column) => {
              const probability = pool.matchups[row][column];
              const title = `Win | loss against ${opponent.map((id) => memberOf(id).name).join(' / ')}`;
              const odds = probability == null ? 'Unknown' : <><span className="matchup-win">{percent(probability)}</span> | <span className="matchup-loss">{percent(1 - probability)}</span></>;
              return <td key={teamKey(opponent)} title={row === column ? undefined : title}>
                {row === column ? '-' : odds}
              </td>;
            })}
            <td>{pool.byRank ? percent(pool.byRank[0].get(teamKey(team)).p) : 'Unknown'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {pool.tieP != null && pool.tieP > 0 && <p className="muted">Tie for first: {percent(pool.tieP)}</p>}
      {!pool.byRank && <p className="muted">Group odds unavailable: missing rankings or too many unresolved matches.</p>}
    </section>)}
    {note && <p className="muted">{note}</p>}
    {tree && <PlayoffBracket tree={tree} outlook={outlook} ownKey={ownKey} memberOf={memberOf} eventName={event.name} />}
    {outlook?.titleP != null && <p className="knockout-title">Chance to win the event: {percent(outlook.titleP)}</p>}
  </div>;
}
const MAX_OPPONENTS_SHOWN = 3;

// A certain opponent is just named; otherwise show how likely the meeting is.
const opponentPrefix = (opponent, certain) => (certain ? 'vs ' : `${percent(opponent.p)} `);

function rankingSummary(side) {
  if (side.members?.length > 1) return side.members.map((m) => `#${m.ranking.rank}`).join(' / ');
  return `#${side.ranking.rank} (${side.ranking.points} pts)`;
}

function OpponentSummary({ side, discipline, tournaments }) {
  const members = side.members ?? [];
  const pair = members.length > 1;
  return (
    <div className="opponent">
      <p className="rating">
        <span>vs <SideNames members={members} /> — {rankingSummary(side)}</span>
      </p>
      {members.map((member) => {
        const summary = recordSummary(member.profile?.stats?.[discipline]);
        return (
          <Fragment key={member.id}>
            {summary && (
              <p className="profile-record">
                {pair && `${member.name}: `}{summary}
              </p>
            )}
            <UpcomingTournaments
              entries={member.tournaments}
              tournaments={tournaments}
              title={`${member.name}: upcoming tournaments`}
              collapsible
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function DrawResult({ title, badge, partners, note, opponentResults, tournaments }) {
  return (
    <div className="result">
      <h3>
        {title}
        {badge && <span className="mock-badge">{badge}</span>}
      </h3>
      {partners && <p className="muted">Playing with <SideNames members={partners} /></p>}
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
              <OpponentSummary side={result.sideB} discipline={result.discipline} tournaments={tournaments} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function KnockoutRound({ round, memberOf, allOpponents = false }) {
  if (round.status === 'out') return null;
  const { opponents = [] } = round;
  return (
    <div className="knockout-round">
      <h4>{round.round}</h4>
      {round.status === 'bye' && <p className="muted">Bye - through to the next round</p>}
      {round.status === 'won' && <p className="muted">Won</p>}
      {round.status === 'lost' && <p className="muted">Lost - out of the draw</p>}
      {round.status === 'unknown' && (
        <><p className="error">
          {round.missing.length ? <>Can't be simulated: {round.missing.join(', ')} {round.missing.length > 1 ? 'have' : 'has'} no national ranking data.</> : 'Forecast unavailable until the group outcome is known.'}
        </p>
        {allOpponents && <ul className="knockout-opponents">
          {(round.candidates ?? []).map(({ team, winP }) => <li key={teamKey(team)}>
            <SideNames members={team.map(memberOf)} /> - {winP == null ? 'match odds unknown' : `you win ${percent(winP)}`}
          </li>)}
        </ul>}</>
      )}
      {round.status === 'upcoming' && (
        <>
          <div className="bar">
            <div className="bar-a" style={{ width: percent(round.winP) }}>{percent(round.winP)}</div>
            <div className="bar-b" style={{ width: percent(1 - round.winP) }}>{percent(1 - round.winP)}</div>
          </div>
          {round.reach < 1 && <p className="muted">{percent(round.reach)} chance of getting here</p>}
          {allOpponents && <p className="muted">Win and advance, from the start: {percent(round.reach * round.winP)}</p>}
          <ul className="knockout-opponents">
            {(allOpponents ? opponents : opponents.slice(0, MAX_OPPONENTS_SHOWN)).map((opponent) => (
              <li key={opponent.name}>
                {opponentPrefix(opponent, opponents.length === 1)}<SideNames members={opponent.team.map(memberOf)} /> - you win {percent(opponent.winP)}
              </li>
            ))}
            {!allOpponents && opponents.length > MAX_OPPONENTS_SHOWN && <li className="muted">and {opponents.length - MAX_OPPONENTS_SHOWN} more possible opponents</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function KnockoutResult({ title, badge, partners, note, outlook, memberOf }) {
  return (
    <div className="result">
      <h3>
        {title}
        {badge && <span className="mock-badge">{badge}</span>}
      </h3>
      {partners && <p className="muted">Playing with <SideNames members={partners} /></p>}
      {note && <p className="muted">{note}</p>}
      {outlook.tree
        ? <PlayoffBracket tree={outlook.tree} outlook={outlook} ownKey={outlook.ownKey} memberOf={memberOf} eventName={title} />
        : outlook.rounds.map((round) => <KnockoutRound key={round.round} round={round} memberOf={memberOf} />)}
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
  const [eventResults, setEventResults] = useState([]);
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
  const memberOf = (id) => {
    const found = players.find((p) => p.id === id);
    return { id, name: found?.name ?? id, profile: found?.profile ?? null, url: found?.url ?? null };
  };

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
      setEventResults([]);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setEventResults([]);
    Promise.all([
      Promise.all(relevantDraws.map((entry) => simulatePublishedDraw(tournamentId, entry))),
      Promise.all(playerEvents(tournament, playerId).map((entry) => simulateEvent(tournamentId, entry, tournament.draws ?? []))),
    ])
      .then(([results, events]) => {
        if (!cancelled) {
          setDrawResults(results);
          setEventResults(events.filter(Boolean));
        }
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

  const partnersOf = (own) => (own.length > 1 ? own.filter((id) => id !== playerId).map(memberOf) : null);
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
          <ProfileStatsCard profile={player.profile} />
          <p className="profile-row"><PlayerLink name="View profile on Badminton Nederland" url={player.url} /></p>
          <UpcomingTournaments entries={player.tournaments} tournaments={tournaments} title={`${player.name}: upcoming tournaments`} />
        </div>
      )}

      {loading && <p className="muted">Simulating…</p>}
      {error && <p className="error">{error}</p>}

      {eventResults.map((result) => <EventResult key={result.event.event_id} result={result} memberOf={memberOf} />)}

      {drawResults.filter(({ draw }) => !eventResults.some(({ event }) => drawIsForEvent(event, draw))).map(({ draw, own, note, outlook, opponentResults }) => (
        outlook
          ? <KnockoutResult key={draw.draw_id} title={draw.name} partners={partnersOf(own)} note={note} outlook={outlook} memberOf={memberOf} />
          : <DrawResult key={draw.draw_id} title={draw.name} partners={partnersOf(own)} note={note} opponentResults={opponentResults ?? []} tournaments={tournaments} />
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
                Mocked draw format{' '}
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
        const shared = { title: event.name.replace(/\s+/g, ' '), badge: 'Mocked draw', partners: partnersOf(own), note, tournaments };
        return outlook
          ? <KnockoutResult key={event.event_id} {...shared} outlook={outlook} memberOf={memberOf} />
          : <DrawResult key={event.event_id} {...shared} opponentResults={opponentResults} />;
      })}
    </div>
  );
}
