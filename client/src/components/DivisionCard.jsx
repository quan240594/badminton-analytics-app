export default function DivisionCard({ highestDivision }) {
  return (
    <table className="division-table">
      <tbody>
        <tr>
          <th scope="row" className="stat-label">Division</th>
          <td>{highestDivision?.division ?? '-'}</td>
          <th scope="row" className="stat-label">Year</th>
          <td>{highestDivision?.year ?? '-'}</td>
        </tr>
      </tbody>
    </table>
  );
}
