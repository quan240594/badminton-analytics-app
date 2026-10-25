import { parsePlayedAt } from '../lib/profiles.js';
import { formatTournamentDates, tournamentUrl } from '../lib/upcoming.js';

const formatPlayedDay = (text) => parsePlayedAt(text)?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) ?? '';

// One match as toernooi shows it: a grey header with the round, a row per side with its
// game scores, the winner in bold, and the player's own result as a round tag.
function MatchCard({ match, drawName }) {
  const won = match.sides[match.ownIndex].won;
  return (
    <li className="tn-match">
      <div className="tn-match__header">
        <span>{match.round}</span>
        <span className="tn-muted">{drawName}</span>
      </div>
      <div className="tn-match__body">
        <div className="tn-match__rows">
          {match.sides.map((side, index) => (
            <div key={side.players.map((p) => p.player_id).join('+')} className={side.won ? 'tn-match__row has-won' : 'tn-match__row'}>
              <span className="tn-match__names">
                {side.players.map((p) => p.name).join(' / ')}
                {index === match.ownIndex && <span className="tn-match__own"> (profile)</span>}
              </span>
              <span className="tn-match__games">{match.games.map((game) => game[index]).join(' ')}</span>
            </div>
          ))}
        </div>
        <span className={`tn-tag tn-tag--round ${won ? 'tn-tag--success' : 'tn-tag--danger'}`} title={won ? 'Won' : 'Lost'}>{won ? 'W' : 'L'}</span>
      </div>
      {match.played_at && <div className="tn-match__footer">{formatPlayedDay(match.played_at)}</div>}
    </li>
  );
}

// toernooi's "Toernooien" module: every tournament the player has played matches in.
export default function TournamentResults({ results }) {
  return (
    <section className="tn-module">
      <div className="tn-module__banner">
        <h3 className="tn-module__title">Tournaments</h3>
      </div>
      <div className="tn-module__content">
        {results.length === 0 && <p className="tn-muted">No played matches known yet.</p>}
        <ul className="tn-tournaments">
          {results.map(({ tournament, draws }) => (
            <li key={tournament.id} className="tn-tournament">
              <h4 className="tn-media__title">
                <a href={tournamentUrl(tournament.id)} target="_blank" rel="noopener noreferrer">{tournament.name}</a>
              </h4>
              {(tournament.club || tournament.location) && <small className="tn-media__sub">{[tournament.club, tournament.location].filter(Boolean).join(' | ')}</small>}
              <small className="tn-media__sub tn-muted">{formatTournamentDates(tournament.dates)}</small>
              {draws.map(({ draw, matches }) => (
                <div key={draw.draw_id}>
                  <h5 className="tn-divider">{draw.name.replace(/\s+/g, ' ')}</h5>
                  <ol className="tn-matches">
                    {matches.map((match) => <MatchCard key={match.match_id} match={match} drawName={draw.stage || draw.type} />)}
                  </ol>
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
