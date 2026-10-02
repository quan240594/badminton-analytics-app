export default function ProgressBar({ percent }) {
  return (
    <div className="progress-bar">
      <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      <span className="progress-bar-label">{Math.round(percent)}%</span>
    </div>
  );
}
