import { useEffect, useMemo, useRef, useState } from 'react';

export default function ClubSelect({ clubs, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clubs.filter((c) => !q || c.toLowerCase().includes(q)).slice(0, 20);
  }, [clubs, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    const activeEl = listRef.current?.children[activeIndex];
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectClub = (club) => {
    onChange(club);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex === 0) selectClub('');
      else {
        const club = options[activeIndex - 1];
        if (club) selectClub(club);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="club-select">
      <input
        type="text"
        className="club-filter-input"
        placeholder="Club filter"
        value={open ? query : value || ''}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="player-options club-options" ref={listRef}>
          <li
            className={activeIndex === 0 ? 'active' : ''}
            onMouseEnter={() => setActiveIndex(0)}
            onMouseDown={() => selectClub('')}
          >
            All clubs
          </li>
          {options.map((club, idx) => (
            <li
              key={club}
              className={idx + 1 === activeIndex ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(idx + 1)}
              onMouseDown={() => selectClub(club)}
            >
              {club}
            </li>
          ))}
          {options.length === 0 && <li className="empty">No clubs found</li>}
        </ul>
      )}
    </div>
  );
}
