import { SideNames } from './PlayerLink.jsx';
import { teamKey } from '../lib/tournamentDraws.js';

const percent = (probability) => `${Math.round(probability * 100)}%`;

function roundColumns(tree) {
  const columns = [];
  const visit = (node) => {
    const level = node.children.reduce((maximum, child) => Math.max(maximum, visit(child) + 1), 0);
    if (!columns[level]) columns[level] = [];
    columns[level].push(node);
    return level;
  };
  visit(tree);
  return columns;
}

function BracketSide({ side, selectedMatch, ownKey, memberOf }) {
  const containsOwn = side.candidates.some(({ team }) => teamKey(team) === ownKey);
  return <div className="playoff-side">
    {side.label && <p className="playoff-source">{side.label}</p>}
    {side.bye ? <p className="muted">Bye</p> : <ul className="playoff-candidates">
      {side.candidates.map(({ team, p, winP }) => {
        const probability = p == null ? 'Unknown ' : `${percent(p)} `;
        const prefix = selectedMatch && !containsOwn && p === 1 ? 'vs ' : probability;
        return <li key={teamKey(team)} className={teamKey(team) === ownKey ? 'selected-candidate' : undefined}>
        {prefix}<SideNames members={team.map(memberOf)} />
        {selectedMatch && !containsOwn && <> - {winP == null ? 'match odds unknown' : `you win ${percent(winP)}`}</>}
      </li>;
      })}
    </ul>}
  </div>;
}

function FinalSimulation({ match, ownKey, memberOf }) {
  const opponents = match.sides.find((side) => !side.candidates.some(({ team }) => teamKey(team) === ownKey));
  if (!opponents || opponents.bye) return null;
  return <div className="playoff-final-simulation">
    <h6>Potential final matchups</h6>
    <table className="playoff-final-table">
      <thead><tr><th scope="col">Opponent</th><th scope="col">Reaches final</th><th scope="col">You win | lose</th></tr></thead>
      <tbody>{opponents.candidates.map(({ team, p, winP }) => <tr key={teamKey(team)}>
        <th scope="row"><SideNames members={team.map(memberOf)} /></th>
        <td>{p == null ? 'Unknown' : percent(p)}</td>
        <td>{winP == null ? 'Unknown' : `${percent(winP)} | ${percent(1 - winP)}`}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function MatchOutlook({ round, final = false }) {
  if (!round || round.status === 'out') return null;
  if (round.status === 'bye') return <p className="muted">Bye - through to the next round</p>;
  if (round.status === 'won' || round.status === 'lost') return <p className="muted">{round.status === 'won' ? 'Won' : 'Lost - out of the draw'}</p>;
  if (round.status === 'unknown') {
    const verb = round.missing.length > 1 ? 'have' : 'has';
    const message = round.missing.length ? `Can't be simulated: ${round.missing.join(', ')} ${verb} no national ranking data.` : 'Forecast unavailable until the group outcome is known.';
    return <div className="playoff-match-outlook">
      {round.reach != null && <p className="muted">{percent(round.reach)} chance of getting here</p>}
      <p className="error">{message}</p>
      {final && <p className="muted">Overall final win odds and title chance: Unknown</p>}
    </div>;
  }
  return <div className="playoff-match-outlook">
    <p>Win {percent(round.winP)} | Lose {percent(1 - round.winP)}</p>
    <p className="muted">{percent(round.reach)} chance of getting here</p>
    <p className="muted">{final ? 'Chance to win the title' : 'Win and advance, from the start'}: {percent(round.reach * round.winP)}</p>
  </div>;
}

export default function PlayoffBracket({ tree, outlook, ownKey, memberOf, eventName }) {
  const columns = roundColumns(tree);
  return <section className="playoff-bracket" aria-label={`${eventName} playoff bracket`}>
    <h4>Playoff bracket</h4>
    <div className="playoff-tree-scroll">
      <div className="playoff-tree" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(20rem, 1fr))`, minWidth: `${columns.length * 20 + (columns.length - 1) * 2}rem` }}>
        {columns.map((matches, column) => <div className="playoff-column" key={matches[0].round}>
          <h5>{matches[0].round}</h5>
          <div className="playoff-slots" style={{ gridTemplateRows: `repeat(${matches.length}, 1fr)` }}>
            {matches.map((match, index) => <div className={`playoff-slot${column === columns.length - 1 ? ' final-slot' : ''}`} key={match.id}>
              <article className={`playoff-match${match.selected ? ' selected-route' : ''}`} aria-label={`${match.round} match ${index + 1}`}>
                {match.sides.map((side) => <BracketSide key={side.id} side={side} selectedMatch={match.selected} ownKey={ownKey} memberOf={memberOf} />)}
                {match.selected && column === columns.length - 1 && <FinalSimulation match={match} ownKey={ownKey} memberOf={memberOf} />}
                {match.selected && <MatchOutlook round={outlook?.rounds.find((round) => round.round === match.round)} final={column === columns.length - 1} />}
              </article>
            </div>)}
          </div>
        </div>)}
      </div>
    </div>
  </section>;
}