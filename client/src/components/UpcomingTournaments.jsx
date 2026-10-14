import { formatDateRange, tournamentUrl, upcomingTournaments } from '../lib/upcoming.js';

function TournamentList({ upcoming }) {
  return (
    <ul className="upcoming-list">
      {upcoming.map(({ id, name, location, first, last, events }) => (
        <li key={id}>
          <a className="profile-link" href={tournamentUrl(id)} target="_blank" rel="noopener noreferrer">{name}</a>
          <span className="muted">
            {' '}{[formatDateRange(first, last), location, events.join(', ')].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The tournaments a player is entered in that are still to be played. Collapsed
// (and absent when there are none) next to an opponent; always shown for the selected player.
export default function UpcomingTournaments({ entries, tournaments, title = 'Upcoming tournaments', collapsible = false, now }) {
  const upcoming = upcomingTournaments(entries, tournaments, now);

  if (collapsible) {
    if (upcoming.length === 0) return null;
    return (
      <details className="upcoming">
        <summary>{title} ({upcoming.length})</summary>
        <TournamentList upcoming={upcoming} />
      </details>
    );
  }
  return (
    <div className="upcoming">
      <h4>{title}</h4>
      {upcoming.length > 0 ? <TournamentList upcoming={upcoming} /> : <p className="muted">None known yet</p>}
    </div>
  );
}
