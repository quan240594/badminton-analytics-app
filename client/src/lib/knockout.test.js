import { describe, it, expect } from 'vitest';
import { buildBracket, buildMockBracket, analyzeBracket, teamsInBracket } from './knockout.js';

const player = (id) => ({ player_id: id });
const side = (...ids) => ({ won: false, players: ids.map(player) });
const winner = (...ids) => ({ won: true, players: ids.map(player) });
const bye = () => ({ won: false, players: [], bye: true });
const empty = () => ({ won: false, players: [] });
const match = (round, a, b) => ({ round, sides: [a, b] });

// Rating by player id; a team is rated only if every member is.
function modelFor(ratings) {
  const rating = (team) => (team.every((id) => id in ratings) ? team.reduce((s, id) => s + ratings[id], 0) / team.length : null);
  return {
    isRated: (team) => rating(team) != null,
    winProbability: (a, b) => (rating(a) == null || rating(b) == null ? null : 1 / (1 + 10 ** ((rating(b) - rating(a)) / 400))),
  };
}
const EVEN = modelFor({ A: 1500, B: 1500, C: 1500, D: 1500, E: 1500, F: 1500, G: 1500, H: 1500 });
const keys = (team) => team.join('+');

const FOUR = {
  matches: [match('Halve finale', side('A'), side('B')), match('Halve finale', side('C'), side('D')), match('Finale', empty(), empty())],
};

describe('buildBracket', () => {
  it('returns null without a draw, without matches, or without a single final', () => {
    expect(buildBracket(null)).toBeNull();
    expect(buildBracket({ matches: [] })).toBeNull();
    expect(buildBracket({ matches: [match('Halve finale', side('A'), side('B')), match('Halve finale', side('C'), side('D'))] })).toBeNull();
  });

  it('pairs consecutive matches of a round into the next one', () => {
    const root = buildBracket(FOUR);
    expect(root.round).toBe('Finale');
    expect(root.a.round).toBe('Halve finale');
    expect(teamsInBracket(root.a).map(keys)).toEqual(['A', 'B']);
    expect(teamsInBracket(root.b).map(keys)).toEqual(['C', 'D']);
  });

  it('supports a draw that is only a final', () => {
    const root = buildBracket({ matches: [match('Finale', side('A'), side('B'))] });
    expect(teamsInBracket(root).map(keys)).toEqual(['A', 'B']);
  });

  it('keeps byes and carries the result of played matches', () => {
    const root = buildBracket({
      matches: [match('Halve finale', winner('A'), bye()), match('Halve finale', winner('C'), side('D')), match('Finale', side('A'), side('C'))],
    });
    expect(root.a.b).toEqual({ bye: true });
    expect(root.a.winner).toBe('A');
    expect(root.b.winner).toBe('C');
  });

  it('rejects rounds whose sizes do not halve', () => {
    const rounds = [match('R3', side('A'), side('B')), match('R3', side('C'), side('D')), match('R2', side('A'), side('C')), match('Finale', side('A'), side('E'))];
    expect(buildBracket({ matches: rounds })).toBeNull();
  });

  it('rejects a bracket with an undrawn slot it cannot place', () => {
    expect(buildBracket({ matches: [match('Finale', side('A'), empty())] })).toBeNull();
  });

  describe('with a first round missing its bye-versus-bye matches', () => {
    // Round of 16 lists 2 of its 8 matches; the quarterfinals fill the rest.
    const base = (firstRound, quarters) => ({
      matches: [
        ...firstRound,
        ...quarters,
        match('Halve finale', empty(), empty()),
        match('Halve finale', empty(), empty()),
        match('Finale', empty(), empty()),
      ],
    });

    it('treats an empty slot as a bye when no first-round match is waiting to be played', () => {
      const root = buildBracket(base([match('Ronde van 8', winner('A'), bye())], [match('Kwartfinale', side('A'), empty()), match('Kwartfinale', side('B'), side('C')), match('Kwartfinale', side('D'), side('E')), match('Kwartfinale', side('F'), side('G'))]));
      expect(root.a.a.b).toEqual({ bye: true });
    });

    it('places unplayed first-round matches, in order, into the undecided empty slots', () => {
      const root = buildBracket(base([match('Ronde van 8', side('A'), side('B'))], [match('Kwartfinale', empty(), side('C')), match('Kwartfinale', side('D'), side('E')), match('Kwartfinale', side('F'), side('G')), match('Kwartfinale', side('H'), side('I'))]));
      expect(teamsInBracket(root.a.a).map(keys)).toEqual(['A', 'B', 'C']);
    });

    it('gives up when the unplayed matches and the empty slots do not line up', () => {
      const quarters = [match('Kwartfinale', empty(), side('C')), match('Kwartfinale', empty(), side('E')), match('Kwartfinale', side('F'), side('G')), match('Kwartfinale', side('H'), side('I'))];
      expect(buildBracket(base([match('Ronde van 8', side('A'), side('B'))], quarters))).toBeNull();
    });
  });
});

describe('analyzeBracket', () => {
  const root = buildBracket(FOUR);

  it('returns null for a team that is not in the bracket', () => {
    expect(analyzeBracket(root, ['Z'], EVEN)).toBeNull();
  });

  it('gives even odds and a 1 in 4 title chance between equal teams', () => {
    const result = analyzeBracket(root, ['A'], EVEN);
    expect(result.rounds.map((r) => r.round)).toEqual(['Halve finale', 'Finale']);
    expect(result.rounds[0]).toMatchObject({ status: 'upcoming', reach: 1, winP: 0.5 });
    expect(result.rounds[0].opponents.map((o) => [keys(o.team), o.p])).toEqual([['B', 1]]);
    expect(result.rounds[1].reach).toBeCloseTo(0.5);
    expect(result.rounds[1].opponents.map((o) => o.p)).toEqual([0.5, 0.5]);
    expect(result.titleP).toBeCloseTo(0.25);
  });

  it('weights the later opponent by how likely each is to get there', () => {
    const model = modelFor({ A: 1500, B: 1500, C: 1900, D: 1100 });
    const final = analyzeBracket(root, ['A'], model).rounds[1];
    const [likely, unlikely] = final.opponents;
    expect(keys(likely.team)).toBe('C');
    expect(likely.p).toBeGreaterThan(0.9);
    expect(unlikely.p).toBeCloseTo(1 - likely.p);
    expect(final.winP).toBeLessThan(0.3);
  });

  it('advances a team on a bye without a match and keeps its chances', () => {
    const tree = buildBracket({
      matches: [match('Halve finale', winner('A'), bye()), match('Halve finale', side('C'), side('D')), match('Finale', side('A'), empty())],
    });
    const result = analyzeBracket(tree, ['A'], EVEN);
    expect(result.rounds[0]).toMatchObject({ status: 'won' });
    expect(result.rounds[1].opponents.map((o) => o.p)).toEqual([0.5, 0.5]);

    const unplayed = buildBracket({ matches: [match('Halve finale', side('A'), bye()), match('Halve finale', side('C'), side('D')), match('Finale', empty(), empty())] });
    expect(analyzeBracket(unplayed, ['A'], EVEN).rounds[0]).toEqual({ round: 'Halve finale', status: 'bye', reach: 1 });
    expect(analyzeBracket(unplayed, ['A'], EVEN).titleP).toBeCloseTo(0.5);
  });

  it('uses the known result of a played match, whatever the ratings', () => {
    const played = buildBracket({
      matches: [match('Halve finale', winner('A'), side('B')), match('Halve finale', winner('C'), side('D')), match('Finale', empty(), empty())],
    });
    const unrated = modelFor({ A: 1500, C: 1500 });
    const result = analyzeBracket(played, ['A'], unrated);
    expect(result.rounds[0]).toMatchObject({ status: 'won', reach: 1 });
    expect(result.rounds[1]).toMatchObject({ status: 'upcoming', winP: 0.5 });
    expect(result.rounds[1].opponents).toHaveLength(1);
  });

  it('reports a team knocked out and every later round as out', () => {
    const tree = buildBracket({
      matches: [match('Kwartfinale', side('A'), winner('B')), match('Kwartfinale', side('C'), side('D')), match('Kwartfinale', side('E'), side('F')), match('Kwartfinale', side('G'), side('H')), match('Halve finale', empty(), empty()), match('Halve finale', empty(), empty()), match('Finale', empty(), empty())],
    });
    const result = analyzeBracket(tree, ['A'], EVEN);
    expect(result.rounds.map((r) => r.status)).toEqual(['lost', 'out', 'out']);
    expect(result.titleP).toBe(0);
  });

  it('does not guess when an opponent is unranked: that round and the rest are unknown', () => {
    const model = modelFor({ A: 1500, B: 1500, C: 1500 });
    const result = analyzeBracket(root, ['A'], model);
    expect(result.rounds[0].status).toBe('upcoming');
    expect(result.rounds[1]).toMatchObject({ status: 'unknown' });
    expect(result.rounds[1].missing.map(keys)).toEqual(['D']);
    expect(result.titleP).toBeNull();
  });

  it('is unknown from the start when the team itself is unranked', () => {
    const result = analyzeBracket(root, ['A'], modelFor({ B: 1500, C: 1500, D: 1500 }));
    expect(result.rounds[0]).toMatchObject({ status: 'unknown' });
    expect(result.rounds[0].missing.map(keys)).toEqual(['A']);
    expect(result.rounds[1].status).toBe('unknown');
  });

  it('rates doubles pairs by their members', () => {
    const tree = buildBracket({ matches: [match('Finale', side('A', 'B'), side('C', 'D'))] });
    const model = modelFor({ A: 1700, B: 1700, C: 1300, D: 1300 });
    expect(analyzeBracket(tree, ['A', 'B'], model).rounds[0].winP).toBeGreaterThan(0.9);
  });
});

describe('analyzeBracket - consistency', () => {
  it('gives every team a title chance and those chances add up to exactly one', () => {
    const teams = Array.from({ length: 11 }, (_, i) => [`P${i}`]);
    const ratings = Object.fromEntries(teams.map(([id], i) => [id, 1000 + i * 90]));
    const model = modelFor(ratings);
    const root = buildMockBracket(teams);
    const chances = teams.map((team) => analyzeBracket(root, team, model).titleP);
    expect(chances.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
    expect(chances.at(-1)).toBeGreaterThan(chances[0]);
  });
});

describe('buildMockBracket', () => {
  const teams = (n) => Array.from({ length: n }, (_, i) => [`P${i}`]);
  const seeded = (values) => { let i = 0; return () => values[i++ % values.length]; };

  it('needs at least two teams', () => {
    expect(buildMockBracket([])).toBeNull();
    expect(buildMockBracket(teams(1))).toBeNull();
  });

  it('is just a final for two teams', () => {
    const root = buildMockBracket(teams(2));
    expect(root.round).toBe('Finale');
    expect(teamsInBracket(root)).toHaveLength(2);
  });

  it.each([[3, 'Halve finale'], [5, 'Kwartfinale'], [8, 'Kwartfinale'], [9, 'Ronde van 16'], [20, 'Ronde van 32']])('deals %i teams into a bracket starting at %s', (n, firstRound) => {
    let node = buildMockBracket(teams(n), seeded([0.1, 0.7, 0.3, 0.9, 0.5]));
    while (node.a?.round) node = node.a;
    expect(node.round).toBe(firstRound);
  });

  it('places every team exactly once and never gives a match two byes', () => {
    const root = buildMockBracket(teams(11));
    expect(teamsInBracket(root).map(keys).sort()).toEqual(teams(11).map(keys).sort());
    const firstRound = [];
    const walk = (node) => (node.a?.round ? (walk(node.a), walk(node.b)) : firstRound.push(node));
    walk(root);
    expect(firstRound).toHaveLength(8);
    expect(firstRound.filter((m) => m.a.bye || m.b.bye)).toHaveLength(5);
    expect(firstRound.some((m) => m.a.bye && m.b.bye)).toBe(false);
  });

  it('is random: a different draw for a different roll', () => {
    const a = teamsInBracket(buildMockBracket(teams(8), seeded([0.05, 0.4, 0.8])));
    const b = teamsInBracket(buildMockBracket(teams(8), seeded([0.95, 0.2, 0.6])));
    expect(a.map(keys)).not.toEqual(b.map(keys));
  });
});
