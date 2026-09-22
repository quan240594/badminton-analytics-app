const DISCIPLINES = [
  { key: 'singles', label: 'Singles' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'mixed', label: 'Mixed' },
];

const MEDAL_BY_STATUS = {
  Winner: '🥇',
  Finalist: '🥈',
  'Semi-finalist': '🥉',
};

function medalFor(status) {
  return MEDAL_BY_STATUS[status] ?? status;
}

export default function TitlesCard({ titles }) {
  if (!titles) return null;

  return (
    <div>
      <div className="titles-label">Titles</div>
      <table className="titles-table">
        <thead>
          <tr>
            <th className="stat-label">Most recent</th>
            <th className="icon-cell" title="Position">🏆</th>
            <th>Year</th>
            <th>Tournament</th>
          </tr>
        </thead>
        <tbody>
          {DISCIPLINES.map(({ key, label }) => {
            const t = titles[key];
            return (
              <tr key={key}>
                <td className="stat-label">{label}</td>
                <td className="icon-cell" title={t?.status}>{t ? medalFor(t.status) : '-'}</td>
                <td>{t ? t.year : '-'}</td>
                <td>{t ? t.tournament : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
