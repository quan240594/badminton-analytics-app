function formatCell(played, rate) {
  const pct = rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
  return `${played} (${pct})`;
}

const DISCIPLINES = [
  { label: 'Singles', prefix: 'singles' },
  { label: 'Doubles', prefix: 'doubles' },
  { label: 'Mixed', prefix: 'mixed' },
];

function sumMetric(player, metric) {
  const played = DISCIPLINES.reduce((sum, { prefix }) => sum + (player[`${prefix}${metric}Played`] ?? 0), 0);
  const won = DISCIPLINES.reduce((sum, { prefix }) => sum + (player[`${prefix}${metric}Won`] ?? 0), 0);
  const rate = played > 0 ? won / played : null;
  return { played, rate };
}

export default function PlayerStatsCard({ player }) {
  if (!player) return null;

  const matches = { played: DISCIPLINES.reduce((s, { prefix }) => s + (player[`${prefix}Played`] ?? 0), 0), rate: null };
  matches.rate = matches.played > 0 ? DISCIPLINES.reduce((s, { prefix }) => s + (player[`${prefix}Won`] ?? 0), 0) / matches.played : null;
  const sets = sumMetric(player, 'Sets');
  const points = sumMetric(player, 'Points');

  return (
    <table className="player-stats-table">
      <thead>
        <tr>
          <th></th>
          <th>Matches</th>
          <th>Sets</th>
          <th>Points</th>
        </tr>
      </thead>
      <tbody>
        {DISCIPLINES.map(({ label, prefix }) => (
          <tr key={label}>
            <td className="stat-label">{label}</td>
            <td>{formatCell(player[`${prefix}Played`], player[`${prefix}WinRate`])}</td>
            <td>{formatCell(player[`${prefix}SetsPlayed`], player[`${prefix}SetsWinRate`])}</td>
            <td>{formatCell(player[`${prefix}PointsPlayed`], player[`${prefix}PointsWinRate`])}</td>
          </tr>
        ))}
        <tr className="total-row">
          <td className="stat-label">Total</td>
          <td>{formatCell(matches.played, matches.rate)}</td>
          <td>{formatCell(sets.played, sets.rate)}</td>
          <td>{formatCell(points.played, points.rate)}</td>
        </tr>
      </tbody>
    </table>
  );
}
