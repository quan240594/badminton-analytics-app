import { SideNames } from './PlayerLink.jsx';
import { formatDateRange, tournamentUrl, upcomingTournaments } from '../lib/upcoming.js';

// "HD 7 with A / B" - the partners are only there for doubles and mixed events.
function EventLine({ event }) {
  return (
    <div className="event-line">
      {event.name}
      {event.partners.length > 0 && <> with <SideNames members={event.partners} /></>}
    </div>
  );
}

function TournamentTable({ upcoming }) {
  return (
    <table className="upcoming-table">
      <thead>
        <tr>
          <th>Tournament</th>
          <th>Date</th>
          <th>Location</th>
          <th>Events</th>
        </tr>
      </thead>
      <tbody>
        {upcoming.map(({ id, name, location, first, last, events }) => (
          <tr key={id}>
            <td><a className="profile-link" href={tournamentUrl(id)} target="_blank" rel="noopener noreferrer">{name}</a></td>
            <td className="date-cell">{formatDateRange(first, last)}</td>
            <td>{location || '-'}</td>
            <td>{events.length > 0 ? events.map((event) => <EventLine key={event.name} event={event} />) : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
        <TournamentTable upcoming={upcoming} />
      </details>
    );
  }
  return (
    <div className="upcoming">
      <h4>{title}</h4>
      {upcoming.length > 0 ? <TournamentTable upcoming={upcoming} /> : <p className="muted">None known yet</p>}
    </div>
  );
}
