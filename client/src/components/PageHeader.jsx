import ProgressBar from './ProgressBar.jsx';

// Shared header-row: title/subtitle plus the always-present Clear all control;
// Fetch data (admin-only) and page-specific extras go in extraActions.
export default function PageHeader({ title, subtitle, onClearAll, refreshState, showUnchanged, onFetchData, isAdmin, extraActions }) {
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
        {isAdmin && (
          <div className="refresh-control">
            {showUnchanged && <div className="unchanged-bubble">Data already up to date</div>}
            <button type="button" className="btn-outline" onClick={onFetchData} disabled={refreshState.running}>
              {refreshState.running ? 'Fetching…' : 'Fetch data'}
            </button>
            {refreshState.running && <ProgressBar percent={refreshState.percent} />}
            {refreshState.error && <p className="error">{refreshState.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
