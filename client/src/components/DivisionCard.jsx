export default function DivisionCard({ highestDivision }) {
  return (
    <table className="division-table">
      <tbody>
        <tr>
          <td className="stat-label">Division</td>
          <td>{highestDivision?.division ?? '-'}</td>
          <td className="stat-label">Year</td>
          <td>{highestDivision?.year ?? '-'}</td>
        </tr>
      </tbody>
    </table>
  );
}
