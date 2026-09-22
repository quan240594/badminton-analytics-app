function fmt(count) {
  return count > 0 ? count : '-';
}

export default function CareerMedalsCard({ titleCounts, titleYears }) {
  if (!titleCounts) return null;

  return (
    <table className="career-medals-table">
      <thead>
        <tr>
          <th className="stat-label">Career</th>
          <th className="icon-cell">🥇</th>
          <th className="icon-cell">🥈</th>
          <th className="icon-cell">🥉</th>
        </tr>
      </thead>
      <tbody>
        {titleYears.map((year) => {
          const counts = titleCounts.byYear[year];
          return (
            <tr key={year}>
              <td className="stat-label">{year}</td>
              <td>{fmt(counts.gold)}</td>
              <td>{fmt(counts.silver)}</td>
              <td>{fmt(counts.bronze)}</td>
            </tr>
          );
        })}
        <tr className="total-row">
          <td className="stat-label">Total</td>
          <td>{fmt(titleCounts.total.gold)}</td>
          <td>{fmt(titleCounts.total.silver)}</td>
          <td>{fmt(titleCounts.total.bronze)}</td>
        </tr>
      </tbody>
    </table>
  );
}
