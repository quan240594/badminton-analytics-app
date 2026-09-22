import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayers, simulateMatch } from '../api.js';
import PlayerSelect from '../components/PlayerSelect.jsx';
import ClubSelect from '../components/ClubSelect.jsx';

const STORAGE_KEY = 'badminton-app-league-day-state';
const MAX_RECOMMENDED_APPEARANCES = 3;

// Rubber composition + codes confirmed from real scraped team-match pages:
// - all-men divisions (Mannen Veer/Nylon): 4x doubles + 4x singles, all men's.
// - numbered/open divisions (3e-9e divisie etc.): 1 MD + 1 WD + 2 MS + 2 WS + 2 XD.
// Our data has no per-player gender field, so WS/WD/XD slots aren't gender-validated.
const FORMATS = {
  mens: {
    label: "Men's division (Mannen Veer / Nylon)",
    codes: ['MD1', 'MD2', 'MS1', 'MS2', 'MS3', 'MS4', 'MD3', 'MD4'],
  },
  mixed: {
    label: 'Mixed division (numbered afd., e.g. 3e-9e divisie)',
    codes: ['MD', 'WD', 'MS1', 'WS1', 'MS2', 'WS2', 'XD1', 'XD2'],
  },
};

function disciplineForCode(code) {
  if (code.startsWith('XD')) return 'mixed';
  if (code.startsWith('MD') || code.startsWith('WD')) return 'doubles';
  return 'singles';
}

function emptySlots(format) {
  return FORMATS[format].codes.map((code) => ({
    code,
    sideA: disciplineForCode(code) === 'singles' ? [''] : ['', ''],
    sideB: disciplineForCode(code) === 'singles' ? [''] : ['', ''],
  }));
}

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.format && Array.isArray(parsed.slots)) return parsed;
  } catch {
    // ignore malformed/unavailable storage
  }
  return null;
}

function filterByClub(players, clubFilter, keepIds) {
  if (!clubFilter) return players;
  return players.filter((p) => p.club === clubFilter || keepIds.includes(p.id));
}

function otherIdsInSlot(slot, side, idx) {
  const ids = [];
  slot.sideA.forEach((id, i) => { if (!(side === 'sideA' && i === idx)) ids.push(id); });
  slot.sideB.forEach((id, i) => { if (!(side === 'sideB' && i === idx)) ids.push(id); });
  return ids.filter(Boolean);
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function ratingFor(prefix, player) {
  return player[`${prefix}Rating`] ?? 1500;
}

function combos2(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

// Higher is better for whichever button was clicked: closest to 50/50 for
// "excitement", or maximizing/minimizing Side A's win chance for the other two.
function objectiveScore(objective, probA) {
  if (objective === 'excitement') return -Math.abs(probA - 0.5);
  return objective === 'clubA' ? probA : 1 - probA;
}

// Poisson-binomial distribution of total rubbers won by Side A, given each
// rubber's independent win probability - dist[k] = P(A wins exactly k rubbers).
function winDistribution(probs) {
  let dist = [1];
  for (const p of probs) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

export default function LeagueDaySimulator() {
  const stored = loadStoredState();
  const [players, setPlayers] = useState([]);
  const [format, setFormat] = useState(stored?.format ?? 'mens');
  const [clubFilterA, setClubFilterA] = useState(stored?.clubFilterA ?? 'DROP SHOT BC');
  const [clubFilterB, setClubFilterB] = useState(stored?.clubFilterB ?? '');
  const [slots, setSlots] = useState(stored?.slots ?? emptySlots(stored?.format ?? 'mens'));
  const [results, setResults] = useState({});
  const [error, setError] = useState('');
  const simulationRequestId = useRef(0);

  const clubs = [...new Set(players.map((p) => p.club).filter(Boolean))].sort();
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  useEffect(() => {
    fetchPlayers().then(setPlayers).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ format, clubFilterA, clubFilterB, slots }));
  }, [format, clubFilterA, clubFilterB, slots]);

  const changeFormat = (next) => {
    setFormat(next);
    setSlots(emptySlots(next));
    setResults({});
  };

  const updateSlot = (code, side, idx, value) => {
    setSlots((prev) => prev.map((slot) => {
      if (slot.code !== code) return slot;
      const nextSide = [...slot[side]];
      nextSide[idx] = value;
      return { ...slot, [side]: nextSide };
    }));
  };

  const clearAll = () => {
    setSlots(emptySlots(format));
    setResults({});
    localStorage.removeItem(STORAGE_KEY);
  };

  // Dropping a club filter that no longer matches an already-selected player
  // clears that slot instead of silently keeping an out-of-filter player.
  const changeClubFilter = (side, setFilter) => (club) => {
    setFilter(club);
    if (!club) return;
    setSlots((prev) => prev.map((slot) => ({
      ...slot,
      [side]: slot[side].map((id) => {
        const p = byId.get(id);
        return p && p.club !== club ? '' : id;
      }),
    })));
  };
  const handleClubFilterA = changeClubFilter('sideA', setClubFilterA);
  const handleClubFilterB = changeClubFilter('sideB', setClubFilterB);

  // Greedily fills every rubber to optimize one objective at a time. Each rubber's
  // win probability only depends on who's in it, so maximizing (or minimizing) the
  // sum of those probabilities - or minimizing each one's distance from 50/50 for
  // "closest ratings" - can be done one rubber at a time without losing optimality,
  // aside from the appearance cap below (falls back to ignoring it if a roster is
  // too small to fill every rubber within it).
  const autoFill = (objective) => {
    const usage = new Map();
    const poolA = filterByClub(players, clubFilterA, []);
    const poolB = filterByClub(players, clubFilterB, []);

    const nextSlots = slots.map((slot) => {
      const discipline = disciplineForCode(slot.code);
      const withinCap = (p) => (usage.get(p.id) ?? 0) < MAX_RECOMMENDED_APPEARANCES;
      const availA = poolA.filter(withinCap);
      const availB = poolB.filter(withinCap);
      const candidatesA = availA.length ? availA : poolA;
      const candidatesB = availB.length ? availB : poolB;

      let bestScore = -Infinity;
      let bestA = null;
      let bestB = null;

      if (discipline === 'singles') {
        for (const a of candidatesA) {
          for (const b of candidatesB) {
            if (a.id === b.id) continue;
            const probA = expectedScore(ratingFor('singles', a), ratingFor('singles', b));
            const score = objectiveScore(objective, probA);
            if (score > bestScore) {
              bestScore = score;
              bestA = [a.id];
              bestB = [b.id];
            }
          }
        }
      } else {
        for (const [a1, a2] of combos2(candidatesA)) {
          const ratingA = (ratingFor(discipline, a1) + ratingFor(discipline, a2)) / 2;
          for (const [b1, b2] of combos2(candidatesB)) {
            if (a1.id === b1.id || a1.id === b2.id || a2.id === b1.id || a2.id === b2.id) continue;
            const ratingB = (ratingFor(discipline, b1) + ratingFor(discipline, b2)) / 2;
            const probA = expectedScore(ratingA, ratingB);
            const score = objectiveScore(objective, probA);
            if (score > bestScore) {
              bestScore = score;
              bestA = [a1.id, a2.id];
              bestB = [b1.id, b2.id];
            }
          }
        }
      }

      if (!bestA || !bestB) return slot; // not enough eligible players for this rubber
      for (const id of [...bestA, ...bestB]) usage.set(id, (usage.get(id) ?? 0) + 1);
      return { ...slot, sideA: bestA, sideB: bestB };
    });

    setSlots(nextSlots);
  };

  // Auto-simulate every fully-filled rubber whenever the roster changes;
  // invalidates in-flight requests from a previous roster the same way the
  // single-match page does, so a slow response can't overwrite newer results.
  useEffect(() => {
    const requestId = ++simulationRequestId.current;
    (async () => {
      const next = {};
      for (const slot of slots) {
        if (!slot.sideA.every(Boolean) || !slot.sideB.every(Boolean)) continue;
        try {
          next[slot.code] = await simulateMatch(disciplineForCode(slot.code), slot.sideA, slot.sideB);
        } catch {
          // leave this rubber out of the summary (e.g. same player picked on both sides)
        }
      }
      if (simulationRequestId.current === requestId) setResults(next);
    })();
  }, [slots]);

  const usageCounts = useMemo(() => {
    const counts = new Map();
    for (const slot of slots) {
      for (const id of [...slot.sideA, ...slot.sideB]) {
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [slots]);

  const overusedPlayers = [...usageCounts.entries()]
    .filter(([, count]) => count > MAX_RECOMMENDED_APPEARANCES)
    .map(([id, count]) => ({ name: byId.get(id)?.name ?? id, count }));

  const filledResults = Object.values(results);
  const nightComplete = filledResults.length === slots.length;
  const probs = filledResults.map((r) => r.winProbabilityA);
  const expectedA = probs.reduce((s, p) => s + p, 0);
  const expectedB = probs.length - expectedA;
  const dist = nightComplete ? winDistribution(probs) : null;
  const pAWin = dist ? dist.slice(5).reduce((s, x) => s + x, 0) : null;
  const pTie = dist ? dist[4] : null;
  const pBWin = dist ? dist.slice(0, 4).reduce((s, x) => s + x, 0) : null;
  const clubLabelA = clubFilterA || 'Side A';
  const clubLabelB = clubFilterB || 'Side B';

  return (
    <div className="app">
      <div className="header-row">
        <div>
          <h1>League Day Simulator</h1>
          <p className="subtitle">
            {players.length} rated players · simulate a full {slots.length}-rubber match night
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn-outline" onClick={clearAll}>
            Clear all
          </button>
        </div>
      </div>

      <div className="league-day-controls">
        <label className="format-select">
          Format:
          <select value={format} onChange={(e) => changeFormat(e.target.value)}>
            {Object.entries(FORMATS).map(([key, f]) => (
              <option key={key} value={key}>{f.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-outline" onClick={() => autoFill('excitement')}>
          Match players with closest ratings
        </button>
        <button type="button" className="btn-outline" onClick={() => autoFill('clubA')}>
          Match players for club A to get at least 5 wins
        </button>
        <button type="button" className="btn-outline" onClick={() => autoFill('clubB')}>
          Match players for club B to get at least 5 wins
        </button>
      </div>

      {overusedPlayers.length > 0 && (
        <p className="error">
          {overusedPlayers.map((p) => `${p.name} is in ${p.count} rubbers`).join('; ')} — real match nights
          usually cap a player at {MAX_RECOMMENDED_APPEARANCES}.
        </p>
      )}

      <div className="rubber-list">
        <div className="rubber-header">
          <div />
          <div className="league-day-team">
            <span>Club A</span>
            <ClubSelect clubs={clubs} value={clubFilterA} onChange={handleClubFilterA} />
          </div>
          <div />
          <div className="league-day-team">
            <span>Club B</span>
            <ClubSelect clubs={clubs} value={clubFilterB} onChange={handleClubFilterB} />
          </div>
        </div>
        {slots.map((slot) => {
          const discipline = disciplineForCode(slot.code);
          const result = results[slot.code];
          const pctA = result ? Math.round(result.winProbabilityA * 100) : null;
          const pctB = result ? 100 - pctA : null;
          return (
            <div className="rubber-row" key={slot.code}>
              <div className="rubber-top">
                <div className="rubber-code">{slot.code}</div>
                <div className="rubber-side">
                  {slot.sideA.map((id, idx) => (
                    <PlayerSelect
                      key={idx}
                      label={discipline === 'singles' ? 'Player' : `Player ${idx + 1}`}
                      players={filterByClub(players, clubFilterA, slot.sideA)}
                      value={id}
                      onChange={(v) => updateSlot(slot.code, 'sideA', idx, v)}
                      excludeIds={otherIdsInSlot(slot, 'sideA', idx)}
                      showClub={false}
                    />
                  ))}
                </div>
                <span className="rubber-vs">vs</span>
                <div className="rubber-side">
                  {slot.sideB.map((id, idx) => (
                    <PlayerSelect
                      key={idx}
                      label={discipline === 'singles' ? 'Player' : `Player ${idx + 1}`}
                      players={filterByClub(players, clubFilterB, slot.sideB)}
                      value={id}
                      onChange={(v) => updateSlot(slot.code, 'sideB', idx, v)}
                      excludeIds={otherIdsInSlot(slot, 'sideB', idx)}
                      showClub={false}
                    />
                  ))}
                </div>
              </div>
              <div className="rubber-result">
                {result ? (
                  <div className="bar compact">
                    <div className="bar-a" style={{ width: `${pctA}%` }}>{pctA > 12 ? `${pctA}%` : ''}</div>
                    <div className="bar-b" style={{ width: `${pctB}%` }}>{pctB > 12 ? `${pctB}%` : ''}</div>
                  </div>
                ) : (
                  <span className="rubber-pending">Fill in both sides to see the projected result</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="night-summary">
        <h3>Night Summary</h3>
        {filledResults.length === 0 ? (
          <p className="h2h muted">Fill in players to see the projected result.</p>
        ) : (
          <>
            <p>
              Expected rubbers — {clubLabelA}: <strong>{expectedA.toFixed(1)}</strong>,{' '}
              {clubLabelB}: <strong>{expectedB.toFixed(1)}</strong>
              {' '}({filledResults.length}/{slots.length} rubbers set)
            </p>
            {nightComplete && (
              <p>
                Win probability — {clubLabelA}: <strong>{Math.round(pAWin * 100)}%</strong>,{' '}
                Tie (4-4): <strong>{Math.round(pTie * 100)}%</strong>,{' '}
                {clubLabelB}: <strong>{Math.round(pBWin * 100)}%</strong>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
