import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEAGUE_INDEX_PATH = path.join(DATA_DIR, 'league_index.json');
const FETCHED_POOLS_PATH = path.join(DATA_DIR, 'fetched_pools.json');
const POOL_ROSTERS_PATH = path.join(DATA_DIR, 'pool_rosters.json');
const PLAYER_FIXED_STATUS_PATH = path.join(DATA_DIR, 'player_fixed_status.json');
const CURRENT_TOURNAMENT_ID = '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E';

// Trailing squad code like "M1"/"M2"/"A2" (letters+digits) or a bare number ("1"/"2").
const SQUAD_SUFFIX_RE = /^(.*?)\s+([A-Za-z]{0,2}\d+)$/;

function splitSquad(name) {
  const m = SQUAD_SUFFIX_RE.exec(name.trim());
  return m ? { club: m[1].trim(), squad: m[2] } : { club: name.trim(), squad: null };
}

function loadRawLeagueIndex() {
  try {
    return JSON.parse(readFileSync(LEAGUE_INDEX_PATH, 'utf-8'));
  } catch {
    return { regions: [], divisions: {} };
  }
}

// Whole region/division/afdeling tree, with each team's raw name split into its
// club + squad code, so the client can drive a division -> pool -> club -> team
// drilldown without any per-selection server round-trip.
export function fullLeagueIndex() {
  const raw = loadRawLeagueIndex();
  const divisions = {};
  for (const [division, afdelingen] of Object.entries(raw.divisions || {})) {
    divisions[division] = afdelingen.map((a) => ({
      drawId: a.drawId,
      division: a.division,
      label: a.label,
      teams: a.teams.map((t) => ({ clubId: t.clubId, ...splitSquad(t.name) })),
    }));
  }
  return { regions: raw.regions || [], divisions };
}

// The single afdeling/pool matching poolLabel's "<division> afd. <n>" suffix
// (e.g. index.js's CURRENT_POOL_LABEL) - used only to pick a sensible default.
export function currentPoolTeams(poolLabel) {
  const { divisions } = fullLeagueIndex();
  const afdelingLabel = poolLabel.split(/\s\u2013\s/)[1]?.trim();
  for (const afdelingen of Object.values(divisions)) {
    const afdeling = afdelingen.find((a) => a.label === afdelingLabel);
    if (afdeling) return afdeling;
  }
  return { drawId: null, label: afdelingLabel ?? null, teams: [] };
}

function loadFetchedPools() {
  try {
    return JSON.parse(readFileSync(FETCHED_POOLS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Which pools already have cached player/match data - the app's original bundled
// pool always counts, plus anything fetch_pool.py has since fetched on demand.
export function fetchedDrawIds(alwaysIncludeDrawId) {
  const ids = new Set(Object.keys(loadFetchedPools()));
  if (alwaysIncludeDrawId) ids.add(String(alwaysIncludeDrawId));
  return [...ids];
}

function loadPoolRostersRaw() {
  try {
    return JSON.parse(readFileSync(POOL_ROSTERS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Local per-tournament ids only resolve to a guid if that player's own page was ever fetched.
export function poolRosters(aliasIndex) {
  const raw = loadPoolRostersRaw();
  const result = {};
  for (const [drawId, localIds] of Object.entries(raw)) {
    result[drawId] = localIds
      .map((localId) => aliasIndex.get(`${CURRENT_TOURNAMENT_ID}:${localId}`))
      .filter(Boolean);
  }
  return result;
}

function loadPlayerFixedStatusRaw() {
  try {
    return JSON.parse(readFileSync(PLAYER_FIXED_STATUS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Guids of players scraped as NOT a team's "Vastspeler" (fixed player) - i.e.
// substitutes - replacing the old hardcoded-by-name substitute list.
export function substitutePlayerIds(aliasIndex) {
  const raw = loadPlayerFixedStatusRaw();
  const ids = [];
  for (const [localId, info] of Object.entries(raw)) {
    if (info.fixed) continue;
    const guid = aliasIndex.get(`${CURRENT_TOURNAMENT_ID}:${localId}`);
    if (guid) ids.push(guid);
  }
  return ids;
}

// {guid: "M"|"F"} - recovered from which of a team roster page's two tables
// (Heren/Dames) a player appears in, since match data itself has no gender field.
export function playerGenders(aliasIndex) {
  const raw = loadPlayerFixedStatusRaw();
  const genders = {};
  for (const [localId, info] of Object.entries(raw)) {
    const guid = aliasIndex.get(`${CURRENT_TOURNAMENT_ID}:${localId}`);
    if (guid) genders[guid] = info.gender;
  }
  return genders;
}
