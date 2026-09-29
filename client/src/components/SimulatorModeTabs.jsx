export default function SimulatorModeTabs({ mode, onChange }) {
  return (
    <div className="simulator-mode-tabs">
      <button type="button" className={mode === 'league' ? 'is-active' : ''} onClick={() => onChange('league')}>
        League match simulator
      </button>
      <button type="button" className={mode === 'tournament' ? 'is-active' : ''} onClick={() => onChange('tournament')}>
        Tournament match simulator
      </button>
    </div>
  );
}
