const DISCIPLINES = [
  { key: 'singles', label: 'Singles' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'mixed', label: 'Mixed' },
];

export default function RankingCard({ nationalRanking }) {
  if (!nationalRanking) return null;

  return (
    <table className="ranking-table">
      <thead>
        <tr>
          <th></th>
          <th>Ranking</th>
          <th>Points</th>
          <th>vs #1 in NL</th>
        </tr>
      </thead>
      <tbody>
        {DISCIPLINES.map(({ key, label }) => {
          const r = nationalRanking[key];
          return (
            <tr key={key}>
              <td className="stat-label">{label}</td>
              <td>{r ? `#${r.rank}` : '-'}</td>
              <td>{r ? r.points : '-'}</td>
              <td>{r && r.topPoints ? `${Math.round(r.pctOfTop * 100)}% of ${r.topName}` : '-'}</td>
            </tr>
          );
        })}
        <tr className="total-row">
          <td className="stat-label">Total</td>
          <td>-</td>
          <td>{DISCIPLINES.reduce((sum, { key }) => sum + (nationalRanking[key]?.points ?? 0), 0) || '-'}</td>
          <td>-</td>
        </tr>
      </tbody>
    </table>
  );
}
