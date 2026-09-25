import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayers, fetchMeta, simulateMatch, triggerPoolRefresh, fetchPoolRefreshProgress, triggerGithubWorkflowPoolRefresh, pollGithubWorkflowRun, reloadBundle } from '../api.js';
import useDataRefresh from '../hooks/useDataRefresh.js';
import PageHeader from '../components/PageHeader.jsx';
import PlayerSelect from '../components/PlayerSelect.jsx';
import ClubSelect from '../components/ClubSelect.jsx';

const STORAGE_KEY = 'badminton-app-league-day-state';
const MAX_RECOMMENDED_APPEARANCES = 3;
const MAX_SINGLES_APPEARANCES = 1;
const SMALL_ROSTER_MAX = 4;
// Real "Vastspeler" (fixed player) status scraped per team, resolved server-side
// to a list of substitute player guids (see server/lib/leagueIndex.js).
function isSubstitutePlayer(player, substituteIds) {
  return substituteIds.includes(player.id);
}

// The badge is always rendered (just hidden for non-subs) so every player box
// reserves the same width instead of the input growing/shrinking row to row.
function playerPickerDetail(player, discipline, substituteIds) {
  if (!player) return null;
  const rating = Math.round(ratingFor(discipline, player));
  const winRate = player[`${discipline}WinRate`];
  const pct = winRate == null ? '—' : `${Math.round(winRate * 100)}%`;
  const sub = isSubstitutePlayer(player, substituteIds);
  return (
    <span className="stat-line">
      <span>Rating {rating}</span>
      <span>Win {pct}</span>
      <span className="sub-badge" style={{ visibility: sub ? 'visible' : 'hidden' }}>Sub</span>
    </span>
  );
}

// Rubber composition + codes confirmed from real scraped team-match pages:
// - all-men divisions (Mannen Veer/Nylon): 4x doubles + 4x singles, all men's.
// - numbered/open divisions (3e-9e divisie etc.): 1 MD + 1 WD + 2 MS + 2 WS + 2 XD.
// Our data has no per-player gender field, so WS/WD/XD slots aren't gender-validated.
const FORMATS = {
  mens: {
    codes: ['MD1', 'MD2', 'MS1', 'MS2', 'MS3', 'MS4', 'MD3', 'MD4'],
  },
  mixed: {
    codes: ['MD', 'WD', 'MS1', 'WS1', 'MS2', 'WS2', 'XD1', 'XD2'],
  },
};

// Which rubber composition a division uses - inferred from its name, since our
// data has no explicit format field (see FORMATS' codes comment above).
function formatForDivision(division) {
  return /^Mannen (Veer|Nylon)/i.test(division || '') ? 'mens' : 'mixed';
}

function afdelingNumber(label) {
  const m = /afd\.\s*(\d+)/i.exec(label || '');
  return m ? Number(m[1]) : 0;
}

// Real competitive ranking, not alphabetical: Eredivisie is the top tier, then
// the numbered ladder (1e divisie highest, matching divisionRank in server/lib/dataset.js).
// Non-ladder categories (Mannen Veer/Nylon etc.) have no rank and sort after, alphabetically.
function divisionRank(division) {
  if (/^Eredivisie$/i.test(division || '')) return 0;
  const m = /^(\d+)e\s+divisie/i.exec(division || '');
  return m ? Number(m[1]) : Infinity;
}

// "Mannen Veer 2 afd. 12" + division "Mannen Veer 2" -> "Afd. 12".
function poolLabelSuffix(label, division) {
  const suffix = label.startsWith(division) ? label.slice(division.length).trim() : label;
  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

function disciplineForCode(code) {
  if (code.startsWith('XD')) return 'mixed';
  if (code.startsWith('MD') || code.startsWith('WD')) return 'doubles';
  return 'singles';
}

// MS/MD slots need a man, WS/WD need a woman; XD needs one of each (handled as
// a pairing constraint in bestPairing, not a single required gender here).
function requiredGenderForCode(code) {
  if (code.startsWith('MS') || code.startsWith('MD')) return 'M';
  if (code.startsWith('WS') || code.startsWith('WD')) return 'F';
  return null;
}

// Permissive both ways: a player with no recorded gender can fill either slot,
// so incomplete gender data degrades to "unfiltered" instead of unfillable rubbers.
function isValidMixedPair(p1, p2, genders) {
  const canBe = (p, g) => !genders[p.id] || genders[p.id] === g;
  return (canBe(p1, 'M') && canBe(p2, 'F')) || (canBe(p1, 'F') && canBe(p2, 'M'));
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
    if (parsed.division && Array.isArray(parsed.slots)) return parsed;
  } catch {
    // ignore malformed/unavailable storage
  }
  return null;
}

// When a pool roster is known, only its actual squad (plus any already-selected id) is eligible.
// requiredGender/genders optionally scope the picker to MS/WS/MD/WD's gender requirement.
function filterByClub(players, clubFilter, keepIds, rosterIds = null, requiredGender = null, genders = {}) {
  return players.filter((p) => {
    if (keepIds.includes(p.id)) return true;
    if (clubFilter && p.club !== clubFilter) return false;
    if (requiredGender && genders[p.id] && genders[p.id] !== requiredGender) return false;
    return !rosterIds || rosterIds.includes(p.id);
  });
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

// A real national ranking (years of actual competitive results) is a far more
// reliable "who's actually strongest" signal than our own computed rating, which
// is only ever built from this app's own scraped match sample - easy to be
// misleadingly low for an established player who simply has few (or a rough)
// recorded run of matches in that sample, and easy to look "average" (the 1500
// default) for someone with zero recorded matches instead of genuinely average.
// So: rank nationally-ranked players by rank (lower is better) ahead of everyone
// else, and only fall back to our own rating to order/compare the unranked rest.
function compareStrength(prefix, a, b) {
  const rankA = a.nationalRanking?.[prefix]?.rank;
  const rankB = b.nationalRanking?.[prefix]?.rank;
  if (rankA != null && rankB != null) return rankA - rankB;
  if (rankA != null) return -1;
  if (rankB != null) return 1;
  return ratingFor(prefix, b) - ratingFor(prefix, a);
}

// Read-only team-strength summary shown above the lineup: each discipline's
// strongest eligible player(s), split by gender (site data has no gender field
// on match records, only on team roster pages - see playerGenders).
function teamHighlights(pool, genders) {
  const men = pool.filter((p) => genders[p.id] === 'M');
  const women = pool.filter((p) => genders[p.id] === 'F');
  const topByStrength = (list, prefix, n) => [...list].sort((a, b) => compareStrength(prefix, a, b)).slice(0, n);
  return {
    highestMS: topByStrength(men, 'singles', 1)[0] ?? null,
    highestWS: topByStrength(women, 'singles', 1)[0] ?? null,
    highestMD: topByStrength(men, 'doubles', 2),
    highestWD: topByStrength(women, 'doubles', 2),
    highestXD: [topByStrength(men, 'mixed', 1)[0] ?? null, topByStrength(women, 'mixed', 1)[0] ?? null],
  };
}

// Always the real national ranking points here, not our own computed rating -
// a player with zero recorded league matches still has a meaningful national
// history (or genuinely none, shown as '-'), whereas our own rating would just
// be the meaningless 1500 default for anyone who hasn't played a league match
// yet, which was confusing since compareStrength already uses real ranking to
// pick who's "highest" - the displayed number should match that reasoning.
function rankingPoints(discipline, player) {
  return player.nationalRanking?.[discipline]?.points ?? '-';
}

// One highlights row: singles entries only ever populate the right slot (so
// they line up with doubles' 2nd-player value); doubles populate both - 1st
// player's left-aligned, 2nd player's right-aligned - per an explicit
// alignment request, so every row's numbers form two straight columns.
function highlightRow(label, discipline, entry) {
  const isPair = Array.isArray(entry);
  const players = isPair ? entry : [entry];
  const complete = players.length > 0 && players.every(Boolean) && (!isPair || players.length === 2);
  const name = complete ? players.map((p) => p.name).join(' / ') : '-';
  const leftRating = complete && isPair ? rankingPoints(discipline, players[0]) : '';
  const rightRating = complete ? rankingPoints(discipline, players[players.length - 1]) : '';
  return (
    <div className="team-highlights-row" key={label}>
      <span className="th-label">{label}</span>
      <span className="th-rating th-rating-left">{leftRating}</span>
      <span className="th-name">{name}</span>
      <span className="th-rating th-rating-right">{rightRating}</span>
    </div>
  );
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

// Scores every valid pairing from two candidate pools and returns the best one,
// or null if no valid pairing exists (e.g. a pool too small to avoid overlap).
function bestPairing(discipline, candidatesA, candidatesB, objective, genders = {}) {
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
    // MD/WD candidates are already scoped to one gender by the caller; XD isn't
    // (it needs one of each), so only XD pairs get validated here.
    const pairsA = combos2(candidatesA).filter(([p1, p2]) => discipline !== 'mixed' || isValidMixedPair(p1, p2, genders));
    const pairsB = combos2(candidatesB).filter(([p1, p2]) => discipline !== 'mixed' || isValidMixedPair(p1, p2, genders));
    for (const [a1, a2] of pairsA) {
      const ratingA = (ratingFor(discipline, a1) + ratingFor(discipline, a2)) / 2;
      for (const [b1, b2] of pairsB) {
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
  return bestA && bestB ? { bestA, bestB } : null;
}

// Builds a fixed, evenly-rotated lineup for a roster too small to have any real
// flexibility (e.g. exactly 4 players for an 8-rubber night): each rubber goes to
// whoever has played the fewest rubbers so far, ties broken by who's waited
// longest, skipping anyone excluded from that rubber (e.g. a protected top
// singles player before the singles block starts).
function buildDefaultLineup(pool, slots, isExcludedFn, pinnedFn) {
  const usage = new Map(pool.map((p) => [p.id, 0]));
  const lastUsed = new Map(pool.map((p) => [p.id, -1]));
  const singlesUsage = new Map(pool.map((p) => [p.id, 0]));
  const assignment = {};
  slots.forEach((slot, i) => {
    const discipline = disciplineForCode(slot.code);
    const count = discipline === 'singles' ? 1 : 2;
    const pinned = pinnedFn ? pinnedFn(i) : null;
    // A player usually plays at most one singles rubber a night, but can appear
    // in several doubles rubbers - so this only excludes repeats within singles.
    const alreadyPlayedSingles = (p) => discipline === 'singles'
      && (singlesUsage.get(p.id) ?? 0) >= MAX_SINGLES_APPEARANCES;
    const eligible = pool.filter((p) => !isExcludedFn(p, i) && p.id !== pinned?.id && !alreadyPlayedSingles(p));
    const ranked = [...eligible].sort((a, b) => {
      const byUsage = usage.get(a.id) - usage.get(b.id);
      return byUsage !== 0 ? byUsage : lastUsed.get(a.id) - lastUsed.get(b.id);
    });
    const picked = pinned ? [pinned, ...ranked.slice(0, count - 1)] : ranked.slice(0, count);
    for (const p of picked) {
      usage.set(p.id, usage.get(p.id) + 1);
      lastUsed.set(p.id, i);
      if (discipline === 'singles') singlesUsage.set(p.id, (singlesUsage.get(p.id) ?? 0) + 1);
    }
    assignment[slot.code] = picked.map((p) => p.id);
  });
  return assignment;
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
  const [division, setDivision] = useState(stored?.division ?? 'Mannen Veer 2');
  const [drawId, setDrawId] = useState(stored?.drawId ?? '');
  const [leagueIndex, setLeagueIndex] = useState({ divisions: {} });
  const [fetchedDrawIds, setFetchedDrawIds] = useState([]);
  const [poolRosters, setPoolRosters] = useState({});
  const [substituteIds, setSubstituteIds] = useState([]);
  const [playerGenders, setPlayerGenders] = useState({});
  const [poolFetchState, setPoolFetchState] = useState({ running: false, percent: 0, error: null });
  const [clubFilterA, setClubFilterA] = useState(stored?.clubFilterA ?? 'DROP SHOT BC');
  const [teamFilterA, setTeamFilterA] = useState(stored?.teamFilterA ?? null);
  const [clubFilterB, setClubFilterB] = useState(stored?.clubFilterB ?? '');
  const [teamFilterB, setTeamFilterB] = useState(stored?.teamFilterB ?? null);
  const [slots, setSlots] = useState(stored?.slots ?? emptySlots(formatForDivision(stored?.division ?? 'Mannen Veer 2')));
  const [results, setResults] = useState({});
  const [error, setError] = useState('');
  const [autoFillWarnings, setAutoFillWarnings] = useState([]);
  const [capAppearances, setCapAppearances] = useState(false);
  const [protectTopSingles, setProtectTopSingles] = useState(false);
  const [includeSubstitutes, setIncludeSubstitutes] = useState(false);
  const simulationRequestId = useRef(0);
  const { refreshState, showUnchanged, fetchData } = useDataRefresh((bundle) => setPlayers(bundle.players), drawId);

  const format = formatForDivision(division);
  const poolAfdelingen = leagueIndex.divisions[division] ?? [];
  const poolTeams = useMemo(
    () => poolAfdelingen.find((a) => a.drawId === drawId)?.teams ?? [],
    [poolAfdelingen, drawId]
  );
  const poolClubs = [...new Set(poolTeams.map((t) => t.club))].sort((a, b) => a.localeCompare(b));
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  // null (not []) when this pool has no roster data yet, so filtering falls back to club-only.
  const currentPoolRosterIds = drawId ? (poolRosters[drawId] ?? null) : null;
  const excludeSubsForDisplay = (pool) => (includeSubstitutes ? pool : pool.filter((p) => !isSubstitutePlayer(p, substituteIds)));
  const highlightsA = teamHighlights(excludeSubsForDisplay(filterByClub(players, clubFilterA, [], currentPoolRosterIds)), playerGenders);
  const highlightsB = teamHighlights(excludeSubsForDisplay(filterByClub(players, clubFilterB, [], currentPoolRosterIds)), playerGenders);

  useEffect(() => {
    fetchPlayers().then(setPlayers).catch((e) => setError(e.message));
    fetchMeta()
      .then((meta) => {
        setLeagueIndex(meta.leagueIndex ?? { divisions: {} });
        setFetchedDrawIds(meta.fetchedDrawIds ?? []);
        setPoolRosters(meta.poolRosters ?? {});
        setSubstituteIds(meta.substitutePlayerIds ?? []);
        setPlayerGenders(meta.playerGenders ?? {});
        if (!stored?.drawId && meta.currentPool?.drawId) setDrawId(meta.currentPool.drawId);
      })
      .catch(() => {});
  }, []);

  // If the pool's team list arrives (or changes) after a club is already picked,
  // auto-select its squad only when unambiguous - same rule as changeClubFilter below.
  useEffect(() => {
    if (!clubFilterA) return;
    const teams = poolTeams.filter((t) => t.club === clubFilterA);
    if (teams.length === 1) setTeamFilterA(teams[0].squad);
  }, [poolTeams, clubFilterA]);
  useEffect(() => {
    if (!clubFilterB) return;
    const teams = poolTeams.filter((t) => t.club === clubFilterB);
    if (teams.length === 1) setTeamFilterB(teams[0].squad);
  }, [poolTeams, clubFilterB]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ division, drawId, clubFilterA, teamFilterA, clubFilterB, teamFilterB, slots })
    );
  }, [division, drawId, clubFilterA, teamFilterA, clubFilterB, teamFilterB, slots]);

  const changeDivision = (next) => {
    setDivision(next);
    setDrawId(leagueIndex.divisions[next]?.[0]?.drawId ?? '');
    setSlots(emptySlots(formatForDivision(next)));
    setResults({});
    setClubFilterA('');
    setTeamFilterA(null);
    setClubFilterB('');
    setTeamFilterB(null);
  };

  const changePool = (nextDrawId) => {
    setDrawId(nextDrawId);
    setSlots(emptySlots(format));
    setResults({});
    setClubFilterA('');
    setTeamFilterA(null);
    setClubFilterB('');
    setTeamFilterB(null);
  };

  // Scoped alternative to "Fetch data": only pulls this one pool's players/matches
  // (fetch_pool.py), so picking an uncached pool doesn't pay for a full refresh.
  const fetchPoolData = async () => {
    if (!drawId) return;
    setPoolFetchState({ running: true, percent: 0, error: null });
    const applyRefreshedPool = async () => {
      const bundle = await reloadBundle();
      setPlayers(bundle.players);
      setLeagueIndex(bundle.meta.leagueIndex ?? { divisions: {} });
      setFetchedDrawIds(bundle.meta.fetchedDrawIds ?? []);
      setPoolRosters(bundle.meta.poolRosters ?? {});
      setSubstituteIds(bundle.meta.substitutePlayerIds ?? []);
      setPlayerGenders(bundle.meta.playerGenders ?? {});
    };
    if (import.meta.env.DEV) {
      try {
        await triggerPoolRefresh(drawId);
      } catch (e) {
        setPoolFetchState({ running: false, percent: 0, error: e.message });
        return;
      }
      const poll = async () => {
        let progress;
        try {
          progress = await fetchPoolRefreshProgress();
        } catch {
          setPoolFetchState({ running: false, percent: 0, error: 'Lost connection to the refresh server.' });
          return;
        }
        setPoolFetchState({ running: progress.running, percent: progress.percent, error: progress.error });
        if (progress.running) {
          setTimeout(poll, 1000);
          return;
        }
        if (progress.error) return;
        await applyRefreshedPool();
      };
      poll();
      return;
    }
    // Production (GitHub Pages): no local server, so dispatch deploy.yml with draw_id and poll its run.
    let dispatchedAt;
    try {
      dispatchedAt = await triggerGithubWorkflowPoolRefresh(drawId);
    } catch (e) {
      setPoolFetchState({ running: false, percent: 0, error: e.message });
      return;
    }
    const poll = async () => {
      let run;
      try {
        run = await pollGithubWorkflowRun(dispatchedAt);
      } catch (e) {
        setPoolFetchState({ running: false, percent: 0, error: e.message });
        return;
      }
      const running = run.status !== 'completed';
      const percent = run.status === 'completed' ? 100 : run.status === 'in_progress' ? 60 : 15;
      setPoolFetchState({ running, percent, error: null });
      if (running) {
        setTimeout(poll, 5000);
        return;
      }
      if (run.conclusion !== 'success') {
        setPoolFetchState({
          running: false,
          percent: 100,
          error: `GitHub Actions run finished with "${run.conclusion}" — check the Actions tab for details.`,
        });
        return;
      }
      await applyRefreshedPool();
    };
    // Give GitHub a moment to register the dispatched run before the first poll.
    setTimeout(poll, 5000);
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
    setAutoFillWarnings([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Dropping a club filter that no longer matches an already-selected player
  // clears that slot instead of silently keeping an out-of-filter player. Also
  // resolves the squad: auto-picked when the club has exactly one team in this
  // pool, left for the user to pick (via the team select) when there's more than one.
  const changeClubFilter = (side, setFilter, setTeamFilter) => (club) => {
    setFilter(club);
    const teams = poolTeams.filter((t) => t.club === club);
    setTeamFilter(teams.length === 1 ? teams[0].squad : null);
    if (!club) return;
    setSlots((prev) => prev.map((slot) => ({
      ...slot,
      [side]: slot[side].map((id) => {
        const p = byId.get(id);
        return p && p.club !== club ? '' : id;
      }),
    })));
  };
  const handleClubFilterA = changeClubFilter('sideA', setClubFilterA, setTeamFilterA);
  const handleClubFilterB = changeClubFilter('sideB', setClubFilterB, setTeamFilterB);

  // Greedily fills every rubber to optimize one objective at a time. Each rubber's
  // win probability only depends on who's in it, so maximizing (or minimizing) the
  // sum of those probabilities - or minimizing each one's distance from 50/50 for
  // "closest ratings" - can be done one rubber at a time without losing optimality,
  // aside from the two opt-in filters below.
  const autoFill = (objective) => {
    const usage = new Map();
    const singlesUsage = new Map();
    const excludeSubs = (pool) => (includeSubstitutes ? pool : pool.filter((p) => !isSubstitutePlayer(p, substituteIds)));
    const poolA = excludeSubs(filterByClub(players, clubFilterA, [], currentPoolRosterIds));
    const poolB = excludeSubs(filterByClub(players, clubFilterB, [], currentPoolRosterIds));

    // Each side's strongest MEN's-singles player (MS1 is a men's slot) - ranked
    // by real national ranking first, our own rating only as a fallback (see
    // compareStrength) - and whether they're excluded from rubbers before their
    // singles turn (opt-in filter).
    const strongestSingles = (pool) => {
      const men = pool.filter((p) => !playerGenders[p.id] || playerGenders[p.id] === 'M');
      return men.reduce((best, p) => (!best || compareStrength('singles', p, best) < 0 ? p : best), null);
    };
    const strongestSinglesA = strongestSingles(poolA);
    const strongestSinglesB = strongestSingles(poolB);
    const topSinglesA = protectTopSingles ? strongestSinglesA : null;
    const topSinglesB = protectTopSingles ? strongestSinglesB : null;
    const firstSinglesIndex = slots.findIndex((s) => disciplineForCode(s.code) === 'singles');
    const isProtectedFor = (topSingles) => (p, i) => protectTopSingles
      && firstSinglesIndex !== -1
      && i < firstSinglesIndex
      && p.id === topSingles?.id;
    // MS1 (the first singles rubber) always goes to each side's strongest
    // singles player - matches how real team nights typically seed singles -
    // independent of the protect-top-singles filter above.
    const pinnedAtFirstSingles = (strongest) => (i) => (i === firstSinglesIndex ? strongest : null);
    // A rubber's slot code determines which gender is required (MS/MD -> men,
    // WS/WD -> women; XD needs one of each, validated in bestPairing instead).
    const isWrongGenderFor = (code) => (p) => {
      const required = requiredGenderForCode(code);
      return Boolean(required) && Boolean(playerGenders[p.id]) && playerGenders[p.id] !== required;
    };

    // A club too small to have any real lineup flexibility (e.g. exactly 4
    // players for an 8-rubber night) gets priority: a fixed, evenly-rotated
    // lineup instead of being optimized. The other side still optimizes for the
    // chosen objective, but against that fixed opponent for each rubber.
    const excludeForFixed = (topSingles) => (p, i) => isProtectedFor(topSingles)(p, i) || isWrongGenderFor(slots[i].code)(p);
    const fixedA = poolA.length > 0 && poolA.length <= SMALL_ROSTER_MAX
      ? buildDefaultLineup(poolA, slots, excludeForFixed(topSinglesA), pinnedAtFirstSingles(strongestSinglesA))
      : null;
    const fixedB = poolB.length > 0 && poolB.length <= SMALL_ROSTER_MAX
      ? buildDefaultLineup(poolB, slots, excludeForFixed(topSinglesB), pinnedAtFirstSingles(strongestSinglesB))
      : null;

    const nextSlots = slots.map((slot, slotIndex) => {
      // Both sides already fully hand-entered under "closest ratings" means nothing
      // is left to search for - leave this rubber exactly as typed.
      if (objective === 'excitement' && slot.sideA.every(Boolean) && slot.sideB.every(Boolean)) return slot;

      const discipline = disciplineForCode(slot.code);
      const withinCap = (p) => (usage.get(p.id) ?? 0) < MAX_RECOMMENDED_APPEARANCES;
      const isProtectedHere = (p) => protectTopSingles
        && firstSinglesIndex !== -1
        && slotIndex < firstSinglesIndex
        && (p.id === topSinglesA?.id || p.id === topSinglesB?.id);
      // A player usually plays at most one singles rubber a night, but can
      // appear in several doubles rubbers - so this only excludes repeats
      // within singles rubbers, and is always on (not an opt-in filter).
      const alreadyPlayedSingles = (p) => discipline === 'singles'
        && (singlesUsage.get(p.id) ?? 0) >= MAX_SINGLES_APPEARANCES;
      const isFirstSingles = slotIndex === firstSinglesIndex;
      const forcedA = !fixedA && isFirstSingles && strongestSinglesA ? [strongestSinglesA] : null;
      const forcedB = !fixedB && isFirstSingles && strongestSinglesB ? [strongestSinglesB] : null;

      // Which side (if any) is fixed manual input for this rubber: the declared opponent
      // for clubA/clubB, or whichever side is already fully entered for "closest ratings" -
      // a club's own side is never locked, only re-optimized.
      const manualLockSide = objective === 'clubA' ? (slot.sideB.every(Boolean) ? 'sideB' : null)
        : objective === 'clubB' ? (slot.sideA.every(Boolean) ? 'sideA' : null)
        : slot.sideA.every(Boolean) ? 'sideA'
          : slot.sideB.every(Boolean) ? 'sideB'
            : null;

      // manualLockSide only ever names a side that's already fully entered, so no need
      // to re-check .every(Boolean) here; it overrides both the small-roster fixed
      // lineup and the forced MS1 pick for whichever side it names.
      const manualLockIds = manualLockSide ? slot[manualLockSide] : null;
      const manualLockPlayers = manualLockIds ? manualLockIds.map((id) => byId.get(id)) : null;

      const fixedPlayersA = manualLockSide === 'sideA' && manualLockPlayers
        ? manualLockPlayers
        : (fixedA ? fixedA[slot.code].map((id) => byId.get(id)) : forcedA);
      const fixedPlayersB = manualLockSide === 'sideB' && manualLockPlayers
        ? manualLockPlayers
        : (fixedB ? fixedB[slot.code].map((id) => byId.get(id)) : forcedB);
      const sideALocked = Boolean(fixedA) || (manualLockSide === 'sideA' && Boolean(manualLockPlayers));
      const sideBLocked = Boolean(fixedB) || (manualLockSide === 'sideB' && Boolean(manualLockPlayers));

      // MD/WD candidates are pre-scoped to their required gender here (XD's
      // one-of-each-gender constraint is instead validated inside bestPairing,
      // since it's a pairing rule, not a per-player filter).
      const genderOkHere = (p) => !isWrongGenderFor(slot.code)(p);
      const genderPoolA = poolA.filter(genderOkHere);
      const genderPoolB = poolB.filter(genderOkHere);
      const eligibleA = genderPoolA.filter((p) => !isProtectedHere(p) && !alreadyPlayedSingles(p));
      const eligibleB = genderPoolB.filter((p) => !isProtectedHere(p) && !alreadyPlayedSingles(p));

      // A side with a fixed lineup, or a forced MS1 pick, always faces exactly
      // that player/pair for this rubber; a free side still relaxes its own
      // filters in priority order - cap, then protect-top-singles, then both -
      // if every rubber must be filled.
      const attempts = [
        [fixedPlayersA ?? eligibleA.filter(withinCap), fixedPlayersB ?? eligibleB.filter(withinCap)],
        [fixedPlayersA ?? eligibleA, fixedPlayersB ?? eligibleB],
        [fixedPlayersA ?? genderPoolA.filter(withinCap), fixedPlayersB ?? genderPoolB.filter(withinCap)],
        [fixedPlayersA ?? genderPoolA, fixedPlayersB ?? genderPoolB],
      ];
      let pairing = null;
      for (const [candidatesA, candidatesB] of attempts) {
        pairing = bestPairing(discipline, candidatesA, candidatesB, objective, playerGenders);
        if (pairing) break;
      }

      if (!pairing) return slot; // truly impossible, e.g. a side has too few players
      const { bestA, bestB } = pairing;
      if (!sideALocked) for (const id of bestA) usage.set(id, (usage.get(id) ?? 0) + 1);
      if (!sideBLocked) for (const id of bestB) usage.set(id, (usage.get(id) ?? 0) + 1);
      if (discipline === 'singles') {
        if (!sideALocked) for (const id of bestA) singlesUsage.set(id, (singlesUsage.get(id) ?? 0) + 1);
        if (!sideBLocked) for (const id of bestB) singlesUsage.set(id, (singlesUsage.get(id) ?? 0) + 1);
      }
      return { ...slot, sideA: bestA, sideB: bestB };
    });

    setSlots(nextSlots);
    setAutoFillWarnings(nextSlots
      .filter((slot) => !slot.sideA.every(Boolean) || !slot.sideB.every(Boolean))
      .map((slot) => slot.code));
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
      <PageHeader
        title="League Day Simulator"
        subtitle={`${players.length} rated players · simulate a full ${slots.length}-rubber match night`}
        onClearAll={clearAll}
        refreshState={refreshState}
        showUnchanged={showUnchanged}
        onFetchData={fetchData}
      />

      <div className="league-day-controls">
        <label className="format-select">
          Division:
          <select value={division} onChange={(e) => changeDivision(e.target.value)}>
            {Object.keys(leagueIndex.divisions).sort((a, b) => divisionRank(a) - divisionRank(b) || a.localeCompare(b)).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="format-select">
          Pool:
          <select value={drawId} onChange={(e) => changePool(e.target.value)} disabled={poolAfdelingen.length === 0}>
            {[...poolAfdelingen]
              .sort((a, b) => afdelingNumber(a.label) - afdelingNumber(b.label))
              .map((a) => (
                <option key={a.drawId} value={a.drawId}>{poolLabelSuffix(a.label, division)}</option>
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

      {drawId && !fetchedDrawIds.includes(String(drawId)) && (
        <div className="pool-fetch-banner">
          {poolFetchState.running ? (
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${poolFetchState.percent}%` }} />
              <span className="progress-bar-label">{Math.round(poolFetchState.percent)}%</span>
            </div>
          ) : (
            <>
              <span>No data cached yet for this pool.</span>
              <button type="button" className="btn-outline" onClick={fetchPoolData}>
                Fetch pool data
              </button>
            </>
          )}
          {poolFetchState.error && <p className="error">{poolFetchState.error}</p>}
        </div>
      )}

      <div className="league-day-filters">
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={capAppearances}
            onChange={(e) => setCapAppearances(e.target.checked)}
          />
          No player plays more than 3 matches
        </label>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={protectTopSingles}
            onChange={(e) => setProtectTopSingles(e.target.checked)}
          />
          Top singles player starts fresh
        </label>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={includeSubstitutes}
            onChange={(e) => setIncludeSubstitutes(e.target.checked)}
          />
          Include substitutes
        </label>
      </div>

      {overusedPlayers.length > 0 && (
        <p className="error">
          {overusedPlayers.map((p) => `${p.name} is in ${p.count} rubbers`).join('; ')} — real match nights
          usually cap a player at {MAX_RECOMMENDED_APPEARANCES}.
        </p>
      )}

      {autoFillWarnings.length > 0 && (
        <p className="error">
          Could not fill: {autoFillWarnings.join(', ')} — not enough eligible players for {autoFillWarnings.length === 1 ? 'this rubber' : 'these rubbers'}.
        </p>
      )}

      <div className="rubber-list">
        <div className="rubber-header">
          <div />
          <div className="league-day-team">
            <div className="league-day-team-row">
              <span className="league-day-team-label">Club</span>
              <ClubSelect clubs={poolClubs} value={clubFilterA} onChange={handleClubFilterA} />
            </div>
            {clubFilterA && (() => {
              const teams = poolTeams.filter((t) => t.club === clubFilterA);
              if (teams.length <= 1 && !teamFilterA) return null;
              return (
                <div className="league-day-team-row">
                  <span className="league-day-team-label">Team</span>
                  {teams.length > 1 ? (
                    <select className="team-select" value={teamFilterA ?? ''} onChange={(e) => setTeamFilterA(e.target.value)}>
                      <option value="" disabled>Team…</option>
                      {teams.map((t) => <option key={t.squad} value={t.squad}>{t.squad}</option>)}
                    </select>
                  ) : (
                    <span className="team-label">{teamFilterA}</span>
                  )}
                </div>
              );
            })()}
          </div>
          <div />
          <div className="league-day-team">
            <div className="league-day-team-row">
              <span className="league-day-team-label">Club</span>
              <ClubSelect clubs={poolClubs} value={clubFilterB} onChange={handleClubFilterB} />
            </div>
            {clubFilterB && (() => {
              const teams = poolTeams.filter((t) => t.club === clubFilterB);
              if (teams.length <= 1 && !teamFilterB) return null;
              return (
                <div className="league-day-team-row">
                  <span className="league-day-team-label">Team</span>
                  {teams.length > 1 ? (
                    <select className="team-select" value={teamFilterB ?? ''} onChange={(e) => setTeamFilterB(e.target.value)}>
                      <option value="" disabled>Team…</option>
                      {teams.map((t) => <option key={t.squad} value={t.squad}>{t.squad}</option>)}
                    </select>
                  ) : (
                    <span className="team-label">{teamFilterB}</span>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="team-highlights">
          <div />
          <div className="team-highlights-list">
            {highlightRow('Highest MS player', 'singles', highlightsA.highestMS)}
            {highlightRow('Highest WS player', 'singles', highlightsA.highestWS)}
            {highlightRow('Highest MD players', 'doubles', highlightsA.highestMD)}
            {highlightRow('Highest WD players', 'doubles', highlightsA.highestWD)}
            {highlightRow('Highest XD players', 'mixed', highlightsA.highestXD)}
          </div>
          <div />
          <div className="team-highlights-list">
            {highlightRow('Highest MS player', 'singles', highlightsB.highestMS)}
            {highlightRow('Highest WS player', 'singles', highlightsB.highestWS)}
            {highlightRow('Highest MD players', 'doubles', highlightsB.highestMD)}
            {highlightRow('Highest WD players', 'doubles', highlightsB.highestWD)}
            {highlightRow('Highest XD players', 'mixed', highlightsB.highestXD)}
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
                      players={filterByClub(players, clubFilterA, slot.sideA, currentPoolRosterIds, requiredGenderForCode(slot.code), playerGenders)}
                      value={id}
                      onChange={(v) => updateSlot(slot.code, 'sideA', idx, v)}
                      excludeIds={otherIdsInSlot(slot, 'sideA', idx)}
                      showClub={false}
                      detail={playerPickerDetail(byId.get(id), discipline, substituteIds)}
                      isSubstitute={(p) => isSubstitutePlayer(p, substituteIds)}
                    />
                  ))}
                </div>
                <span className="rubber-vs">vs</span>
                <div className="rubber-side">
                  {slot.sideB.map((id, idx) => (
                    <PlayerSelect
                      key={idx}
                      label={discipline === 'singles' ? 'Player' : `Player ${idx + 1}`}
                      players={filterByClub(players, clubFilterB, slot.sideB, currentPoolRosterIds, requiredGenderForCode(slot.code), playerGenders)}
                      value={id}
                      onChange={(v) => updateSlot(slot.code, 'sideB', idx, v)}
                      excludeIds={otherIdsInSlot(slot, 'sideB', idx)}
                      showClub={false}
                      detail={playerPickerDetail(byId.get(id), discipline, substituteIds)}
                      isSubstitute={(p) => isSubstitutePlayer(p, substituteIds)}
                      mirrored
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
            {nightComplete && (() => {
              const pctA = Math.round(pAWin * 100);
              const pctTieRounded = Math.round(pTie * 100);
              const pctB = 100 - pctA - pctTieRounded; // avoids rounding error making the bar overshoot 100%
              return (
                <div className="night-bar-wrap">
                  <div className="bar night-bar">
                    <div className="bar-a" style={{ width: `${pctA}%` }}>{pctA > 8 ? `${pctA}%` : ''}</div>
                    <div className="bar-tie" style={{ width: `${pctTieRounded}%` }}>{pctTieRounded > 8 ? `${pctTieRounded}%` : ''}</div>
                    <div className="bar-b" style={{ width: `${pctB}%` }}>{pctB > 8 ? `${pctB}%` : ''}</div>
                  </div>
                  <div className="night-bar-legend">
                    <span>{clubLabelA} win</span>
                    <span>Tie (4-4)</span>
                    <span>{clubLabelB} win</span>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
