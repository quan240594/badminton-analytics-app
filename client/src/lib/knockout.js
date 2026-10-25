// Single-elimination brackets for the tournament simulator: reconstructing a
// published draw (or dealing a random one) and working out a team's chances
// round by round. A node is a team ({ team }), a bye ({ bye }), or a match
// ({ round, a, b, winner }); `winner` is set once the match has been played.
import { teamKey, shuffle } from './tournamentDraws.js';

const roundName = (matchesInRound) => {
  if (matchesInRound === 1) return 'Finale';
  if (matchesInRound === 2) return 'Halve finale';
  if (matchesInRound === 4) return 'Kwartfinale';
  return `Ronde van ${matchesInRound * 2}`;
};

function groupRounds(matches) {
  const rounds = [];
  for (const match of matches) {
    let round = rounds.find((r) => r.name === match.round);
    if (!round) {
      round = { name: match.round, matches: [] };
      rounds.push(round);
    }
    round.matches.push(match);
  }
  return rounds;
}

const idsOf = (side) => (side.players ?? []).map((p) => p.player_id).filter(Boolean);
const hasWinner = (match) => match.sides.some((side) => side.won);

// A slot of a match: a team, a bye, or still empty (to be filled by a match
// that has not been played yet).
function slotOf(side) {
  if (side?.bye) return { bye: true };
  const ids = idsOf(side ?? {});
  return ids.length > 0 ? { team: ids } : null;
}

function winnerOf(match) {
  const side = match.sides.find((s) => s.won);
  const ids = side ? idsOf(side) : [];
  return ids.length > 0 ? teamKey(ids) : null;
}

// The published draw's matches are listed round by round in bracket order, so
// match k of a round is fed by matches 2k and 2k+1 of the round before. The
// first round is the exception: a match between two byes is not listed at all,
// so its position is lost. Empty slots of the second round are byes when their
// match is decided or no first-round match is unplayed; otherwise they are
// filled, in order, by the unplayed first-round matches - but only when the two
// counts agree, since anything else could misplace a match. Returns null when
// the structure cannot be recovered.
export function buildBracket(draw) {
  const rounds = groupRounds(draw?.matches ?? []);
  if (rounds.length === 0 || rounds.at(-1).matches.length !== 1) return null;
  if (rounds.some((round, i) => i > 1 && rounds[i - 1].matches.length !== 2 * round.matches.length)) return null;

  const firstCount = rounds[0].matches.length;
  const secondCount = rounds[1]?.matches.length;
  if (secondCount && firstCount > 2 * secondCount) return null;
  const firstIsComplete = !secondCount || firstCount === 2 * secondCount;
  const pending = firstIsComplete ? [] : rounds[0].matches.filter((m) => !hasWinner(m) && m.sides.every((s) => slotOf(s)?.team));
  const emptyUndecided = firstIsComplete ? 0 : rounds[1].matches.filter((m) => !hasWinner(m)).flatMap((m) => m.sides).filter((s) => !slotOf(s)).length;
  if (pending.length > 0 && pending.length !== emptyUndecided) return null;
  let failed = false;

  const build = (roundIndex, matchIndex) => {
    const match = rounds[roundIndex].matches[matchIndex];
    const child = (sideIndex) => {
      const slot = slotOf(match.sides[sideIndex]);
      if (roundIndex === 0) return slot;
      const feeder = roundIndex === 1 && !firstIsComplete ? null : build(roundIndex - 1, 2 * matchIndex + sideIndex);
      if (feeder) return feeder;
      if (slot) return slot;
      if (hasWinner(match) || pending.length === 0) return { bye: true };
      const next = pending.shift();
      if (!next) return null;
      return { round: rounds[0].name, a: slotOf(next.sides[0]), b: slotOf(next.sides[1]), winner: null };
    };
    const a = child(0);
    const b = child(1);
    if (!a || !b) failed = true;
    return { round: rounds[roundIndex].name, a, b, winner: winnerOf(match) };
  };

  const root = build(rounds.length - 1, 0);
  return failed || pending.length > 0 ? null : root;
}

// A random bracket for a field of teams: padded with byes up to a power of two,
// at most one bye per first-round match, as in a real draw.
export function buildMockBracket(teams, random = Math.random) {
  if (teams.length < 2) return null;
  let size = 2;
  while (size < teams.length) size *= 2;
  const matchCount = size / 2;
  const byeAt = new Set(shuffle([...Array(matchCount).keys()], random).slice(0, size - teams.length));
  const queue = shuffle(teams, random);

  let level = [...Array(matchCount).keys()].map((i) => ({
    round: roundName(matchCount),
    a: { team: queue.shift() },
    b: byeAt.has(i) ? { bye: true } : { team: queue.shift() },
    winner: null,
  }));
  while (level.length > 1) {
    const name = roundName(level.length / 2);
    level = level.reduce((next, node, i) => (i % 2 === 0 ? [...next, { round: name, a: node, b: level[i + 1], winner: null }] : next), []);
  }
  return level[0];
}

export function teamsInBracket(node) {
  if (!node) return [];
  if (node.team) return [node.team];
  if (node.bye) return [];
  return [...teamsInBracket(node.a), ...teamsInBracket(node.b)];
}

// Probability of each team coming out of a node alive, as Map(key -> { team, p }),
// or null when some match needs a team that has no rating.
function distribution(node, model, memo) {
  if (node.team) return new Map([[teamKey(node.team), { team: node.team, p: 1 }]]);
  if (node.bye) return new Map();
  if (memo.has(node)) return memo.get(node);

  let result;
  if (node.winner) {
    // Already played: the result is known, whatever the ratings.
    const team = teamsInBracket(node).find((t) => teamKey(t) === node.winner);
    result = team ? new Map([[node.winner, { team, p: 1 }]]) : null;
  } else {
    const left = distribution(node.a, model, memo);
    const right = distribution(node.b, model, memo);
    if (!left || !right) result = null;
    else if (left.size === 0 || right.size === 0) result = left.size === 0 ? right : left;
    else result = playMatch(left, right, model);
  }
  memo.set(node, result);
  return result;
}

function playMatch(left, right, model) {
  const all = [...left.values(), ...right.values()];
  if (all.some((entry) => !model.isRated(entry.team))) return null;
  const result = new Map();
  const add = (mine, theirs) => {
    for (const { team, p } of mine.values()) {
      let beats = 0;
      for (const other of theirs.values()) beats += other.p * model.winProbability(team, other.team);
      result.set(teamKey(team), { team, p: p * beats });
    }
  };
  add(left, right);
  add(right, left);
  return result;
}

function pathTo(node, key) {
  if (!node || node.team) return node?.team && teamKey(node.team) === key ? [] : null;
  if (node.bye) return null;
  for (const [mine, other] of [[node.a, node.b], [node.b, node.a]]) {
    const below = pathTo(mine, key);
    if (below) return [...below, { node, other }];
  }
  return null;
}

// Round-by-round outlook for one team: who they can meet, the chance of
// winning each match, and of getting that far. Null if the team is not in it.
// A round that depends on an unranked team is reported as unknown rather than
// estimated, and so is every round after it.
export function analyzeBracket(root, ownTeam, model) {
  const ownKey = teamKey(ownTeam);
  const path = pathTo(root, ownKey);
  if (!path) return null;

  const memo = new Map();
  let reach = 1;
  let unknown = false;
  const rounds = path.map(({ node, other }) => {
    const base = { round: node.round };
    if (reach === 0) return { ...base, status: 'out', reach: 0 };
    const opponents = unknown ? null : distribution(other, model, memo);
    if (node.winner) {
      const won = node.winner === ownKey;
      reach = won ? reach : 0;
      return { ...base, status: won ? 'won' : 'lost', reach: won ? 1 : 0 };
    }
    if (other.bye) return { ...base, status: 'bye', reach };
    if (unknown || !opponents || !model.isRated(ownTeam)) {
      unknown = true;
      const missing = [...teamsInBracket(other), ownTeam].filter((team) => !model.isRated(team));
      return { ...base, status: 'unknown', missing };
    }
    const entries = [...opponents.values()].map(({ team, p }) => ({ team, p, winP: model.winProbability(ownTeam, team) }));
    entries.sort((x, y) => y.p - x.p);
    const winP = entries.reduce((sum, e) => sum + e.p * e.winP, 0);
    const row = { ...base, status: 'upcoming', reach, winP, opponents: entries };
    reach *= winP;
    return row;
  });
  return { rounds, titleP: unknown ? null : reach };
}
