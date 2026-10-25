import ProgressBar from './ProgressBar.jsx';

export default function PoolFetchBanner({ drawId, fetchedDrawIds, poolFetchState, isAdmin, onFetch }) {
  if (!drawId || fetchedDrawIds.includes(String(drawId))) return null;
  return (
    <div className="pool-fetch-banner">
      {poolFetchState.running ? (
        <ProgressBar percent={poolFetchState.percent} />
      ) : (
        <>
          <span>No data cached yet for this pool.</span>
          {isAdmin ? (
            <button type="button" className="btn-outline" onClick={onFetch}>
              Fetch pool data
            </button>
          ) : (
            <span>Ask an admin to fetch it.</span>
          )}
        </>
      )}
      {poolFetchState.error && <p className="error">{poolFetchState.error}</p>}
    </div>
  );
}
