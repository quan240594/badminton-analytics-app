// Pure helpers for the tournament simulator: which events a player is in,
// who they'd face in a (real or mocked) draw, and how to deal a random one.

// Draw/event names use short Dutch/English codes (JE/ME/HE/DE/MS/WS=singles,
// JD/MD/HD/DD/WD/D=doubles, GD/XD=mixed) or spell it out (Enkel/Dubbel/Gemengd),
// with no explicit discipline field scraped - inferred by prefix/keyword,
// matching the only 3 disciplines national ranking data distinguishes.
export function disciplineForDraw(name) {
  if (!name) return null;
  if (/(?:^(?:GD|XD)\b)|(?:Gemengd)/i.test(name)) return 'mixed';
  if (/(?:^(?:JE|ME|HE|DE|MS|WS)\b)|(?:Enkel)/i.test(name)) return 'singles';
  if (/(?:^(?:JD|MD|HD|DD|WD|D)\b)|(?:Dubbel)/i.test(name)) return 'doubles';
  return null;
}

const normalizeName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// A team is the list of its players' ids: one for singles, two for a pair.
export const teamKey = (team) => [...team].sort((a, b) => String(a).localeCompare(String(b))).join('+');

// Every team appearing in a published draw - from standings when present
// (pools always list the full field there), otherwise from actual match
// participants (knockout draws may not expose standings rows).
export function teamsInDraw(draw) {
  const teams = new Map();
  const add = (players) => {
    const ids = (players ?? []).map((p) => p.player_id).filter(Boolean);
    if (ids.length > 0) teams.set(teamKey(ids), ids);
  };
  for (const row of draw.standings ?? []) add(row.players);
  for (const match of draw.matches ?? []) {
    for (const side of match.sides ?? []) add(side.players);
  }
  return [...teams.values()];
}

// The player's own team in a published draw plus every other team in it.
// A player who never entered the draw has no team there - nothing to simulate.
export function opponentsInDraw(draw, playerId) {
  const teams = teamsInDraw(draw);
  const own = teams.find((team) => team.includes(playerId));
  if (!own) return { own: null, opponents: [] };
  return { own, opponents: teams.filter((team) => team !== own) };
}

// The player's entry in every event they're registered for. Events scraped
// before per-event participants existed carry none, so they're simply absent.
export function playerEvents(tournament, playerId) {
  const found = [];
  for (const event of tournament?.events ?? []) {
    const discipline = disciplineForDraw(event.name);
    const entry = (event.participants ?? []).find((ids) => ids.includes(playerId));
    if (discipline && entry) found.push({ event, discipline, entry });
  }
  return found;
}

// Whether a published draw belongs to this event: real draws are named after
// their event ("<event>", "<event> - Groep A").
export function drawIsForEvent(event, draw) {
  const eventName = normalizeName(event.name);
  const drawName = normalizeName(draw.name);
  return drawName === eventName || drawName.startsWith(`${eventName} -`);
}

export function eventHasDraw(event, draws) {
  return (draws ?? []).some((draw) => drawIsForEvent(event, draw));
}

// How a draw is played, from the site's draw type: "Poule" is a round robin
// (everyone in the pool plays everyone), "Poule - Thuis en Uit" the same twice,
// "Afvalschema" a single-elimination bracket. Anything else is not modelled.
export function drawFormat(draw) {
  const type = normalizeName(draw?.type);
  if (type.startsWith('poule')) return type.includes('thuis en uit') ? 'doubleRoundRobin' : 'roundRobin';
  if (type === 'afvalschema') return 'knockout';
  return null;
}

// Which format a mocked draw should use by default: whatever this tournament's
// main stages are played as. Playoffs are skipped - they follow a pool stage.
export function defaultMockFormat(tournament) {
  const main = (tournament?.draws ?? []).filter((draw) => draw.stage === 'Hoofdschema').map(drawFormat);
  const knockouts = main.filter((format) => format === 'knockout').length;
  const pools = main.filter((format) => format === 'roundRobin' || format === 'doubleRoundRobin').length;
  return knockouts > pools ? 'knockout' : 'pools';
}

// An event's entries as complete teams: a doubles/mixed entry with a single
// player is still waiting for a partner and can't be drawn yet.
export function completeTeams(event, discipline) {
  const size = discipline === 'singles' ? 1 : 2;
  return (event.participants ?? []).filter((ids) => ids.length === size);
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const TARGET_POOL_SIZE = 4;

// Deals teams into random pools of about four (matching how these events are
// really run: round-robin pools, then a knockout) and returns the pool the
// given team landed in. Pool sizes differ by at most one.
export function mockPoolFor(teams, ownTeam, random = Math.random) {
  const ownKey = teamKey(ownTeam);
  const others = shuffle(teams.filter((team) => teamKey(team) !== ownKey), random);
  const everyone = [ownTeam, ...others];
  const poolCount = Math.max(1, Math.round(everyone.length / TARGET_POOL_SIZE));
  const pools = Array.from({ length: poolCount }, () => []);
  shuffle(everyone, random).forEach((team, index) => pools[index % poolCount].push(team));
  const pool = pools.find((members) => members.some((team) => teamKey(team) === ownKey));
  return { poolSize: pool.length, poolCount, opponents: pool.filter((team) => teamKey(team) !== ownKey) };
}
