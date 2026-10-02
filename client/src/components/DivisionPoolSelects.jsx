import { afdelingNumber, divisionRank, poolLabelSuffix } from '../lib/poolUtils.js';

export default function DivisionPoolSelects({ divisions, division, onDivisionChange, poolAfdelingen, drawId, onPoolChange }) {
  const sortedDivisions = [...divisions].sort((a, b) => divisionRank(a) - divisionRank(b) || a.localeCompare(b));
  const sortedPools = [...poolAfdelingen].sort((a, b) => afdelingNumber(a.label) - afdelingNumber(b.label));
  return (
    <>
      <label className="format-select">
        Division:{' '}
        <select value={division} onChange={(e) => onDivisionChange(e.target.value)}>
          {sortedDivisions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="format-select">
        Pool:{' '}
        <select value={drawId} onChange={(e) => onPoolChange(e.target.value)} disabled={poolAfdelingen.length === 0}>
          {sortedPools.map((a) => (
            <option key={a.drawId} value={a.drawId}>{poolLabelSuffix(a.label, division)}</option>
          ))}
        </select>
      </label>
    </>
  );
}
