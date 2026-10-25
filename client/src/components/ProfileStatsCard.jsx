import { formatRecord } from '../lib/profile.js';

const DISCIPLINES = [
  { key: 'total', label: 'Total' },
  { key: 'singles', label: 'Singles' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'mixed', label: 'Mixed' },
];

// The site lists several matches per day, so a date alone is not a key.
function keyedForm(form) {
  const seen = new Map();
  return form.map((match) => {
    const base = `${match.date}-${match.won}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...match, key: `${base}-${count}` };
  });
}

// Win-loss statistics from the player's Badminton Nederland profile.
export default function ProfileStatsCard({ profile }) {
  if (!profile?.guid) return null;
  const rows = DISCIPLINES.filter(({ key }) => profile.stats?.[key]);
  const form = profile.stats?.total?.form ?? [];
  if (rows.length === 0 && form.length === 0) return null;

  return (
    <div className="profile-stats">
      {rows.length > 0 && (
        <table className="ranking-table">
          <thead>
            <tr>
              <th>Wins–losses</th>
              <th>Career</th>
              <th>This year</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => (
              <tr key={key} className={key === 'total' ? 'total-row' : undefined}>
                <td className="stat-label">{label}</td>
                <td>{formatRecord(profile.stats[key].career)}</td>
                <td>{formatRecord(profile.stats[key].thisYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {form.length > 0 && (
        <p className="profile-form">
          Last matches{' '}
          {keyedForm(form).map(({ key, date, won }) => (
            <span key={key} className={`form-chip ${won ? 'won' : 'lost'}`} title={date}>
              {won ? 'W' : 'L'}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
