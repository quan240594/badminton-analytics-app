// Shared header-row: title/subtitle plus the always-present Clear all + Fetch
// data controls; page-specific extras (e.g. Remove partners) go in extraActions.
export default function PageHeader({ title, subtitle, onClearAll, refreshState, showUnchanged, onFetchData, extraActions }) {
  return (
    <div className="header-row">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="header-actions">
        {extraActions}
        <button type="button" className="btn-outline" onClick={onClearAll}>
          Clear all
        </button>
        <div className="refresh-control">
          {showUnchanged && <div className="unchanged-bubble">Data already up to date</div>}
          <button type="button" className="btn-outline" onClick={onFetchData} disabled={refreshState.running}>
            {refreshState.running ? 'Fetching…' : 'Fetch data'}
          </button>
          {refreshState.running && (
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${refreshState.percent}%` }} />
              <span className="progress-bar-label">{Math.round(refreshState.percent)}%</span>
            </div>
          )}
          {refreshState.error && <p className="error">{refreshState.error}</p>}
        </div>
      </div>
    </div>
  );
}
