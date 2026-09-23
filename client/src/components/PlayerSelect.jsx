import { useEffect, useMemo, useRef, useState } from 'react';

export default function PlayerSelect({ label, players, value, onChange, excludeIds = [], showClub = true, detail, isSubstitute }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);

  const selected = players.find((p) => p.id === value);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => p.id === value || !excludeIds.includes(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [players, query, excludeIds, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    const activeEl = listRef.current?.children[activeIndex];
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectOption = (p) => {
    onChange(p.id);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) selectOption(option);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="player-select">
      <label>{label}</label>
      <div className="player-select-row">
        <input
          type="text"
          placeholder="Search player..."
          value={open ? query : selected ? selected.name : ''}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {detail && !open && selected && <span className="player-select-detail">{detail}</span>}
      </div>
      {showClub && !open && selected && <div className="player-select-club">Club: {selected.club}</div>}
      {open && (
        <ul className="player-options" ref={listRef}>
          {options.map((p, idx) => (
            <li
              key={p.id}
              className={idx === activeIndex ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={() => selectOption(p)}
            >
              {p.name} <span className="club">{p.club}</span>
              {isSubstitute?.(p) && <span className="sub-tag">(Sub)</span>}
            </li>
          ))}
          {options.length === 0 && <li className="empty">No players found</li>}
        </ul>
      )}
    </div>
  );
}
