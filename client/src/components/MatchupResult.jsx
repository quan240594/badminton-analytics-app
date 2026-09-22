export default function MatchupResult({ result }) {
  if (!result) return null;

  const mode = result.playerA ? 'singles' : 'doubles';
  const pctA = Math.round(result.winProbabilityA * 100);
  const pctB = 100 - pctA;

  const sideA = mode === 'singles' ? [result.playerA] : result.teamA;
  const sideB = mode === 'singles' ? [result.playerB] : result.teamB;
  const ratingA = mode === 'singles' ? result.playerA.rating : result.teamARating;
  const ratingB = mode === 'singles' ? result.playerB.rating : result.teamBRating;
  const nameOf = (side) => side.map((p) => p.name).join(' & ');

  const h2h = result.headToHead;
  const h2hText = h2h
    ? mode === 'singles'
      ? `${h2h.playerAWins} - ${h2h.playerBWins}`
      : `${h2h.teamAWins} - ${h2h.teamBWins}`
    : null;

  return (
    <div className="result">
      <div className="bar">
        <div className="bar-a" style={{ width: `${pctA}%` }}>
          {pctA > 8 ? `${pctA}%` : ''}
        </div>
        <div className="bar-b" style={{ width: `${pctB}%` }}>
          {pctB > 8 ? `${pctB}%` : ''}
        </div>
      </div>

      <div className="sides">
        <div className="side">
          <h3>{nameOf(sideA)}</h3>
          <p className="rating">Rating: {ratingA}</p>
          {sideA.map((p) => (
            <p key={p.id} className={`confidence ${p.confidence}`}>
              {p.name}: {p.played} rated matches ({p.confidence} confidence)
            </p>
          ))}
        </div>
        <div className="side">
          <h3>{nameOf(sideB)}</h3>
          <p className="rating">Rating: {ratingB}</p>
          {sideB.map((p) => (
            <p key={p.id} className={`confidence ${p.confidence}`}>
              {p.name}: {p.played} rated matches ({p.confidence} confidence)
            </p>
          ))}
        </div>
      </div>

      <p className={`h2h ${h2hText ? '' : 'muted'}`}>
        {h2hText ? `Head-to-head: ${h2hText}` : 'No recorded head-to-head matches'}
      </p>
    </div>
  );
}
