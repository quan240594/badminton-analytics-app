import { describe, it, expect } from 'vitest';
import {
  disciplineForDraw, teamKey, teamsInDraw, opponentsInDraw, playerEvents, eventHasDraw, completeTeams, shuffle, mockPoolFor,
} from './tournamentDraws.js';

const row = (...ids) => ({ players: ids.map((player_id) => ({ player_id })) });

describe('disciplineForDraw', () => {
  it.each([
    ['Categorie 7 -  Heren Enkel', 'singles'], ['Categorie 7 -  Heren Dubbel', 'doubles'], ['Categorie 5 -  Gemengd Dubbel', 'mixed'],
    ['MS U11', 'singles'], ['WS U11', 'singles'], ['MD U11', 'doubles'], ['WD U11', 'doubles'], ['XD U11', 'mixed'],
    ['GD', 'mixed'], ['ME', 'singles'], ['JD', 'doubles'], ['Rol Enkel A - Groep B', 'singles'], ['Dubbel U11', 'doubles'],
  ])('reads %s as %s', (name, expected) => {
    expect(disciplineForDraw(name)).toBe(expected);
  });

  it.each([['unrecognised', 'XYZ'], ['missing', undefined], ['empty', '']])('returns null for a %s name', (_case, name) => {
    expect(disciplineForDraw(name)).toBeNull();
  });
});

describe('teamKey', () => {
  it('ignores the order of the members', () => {
    expect(teamKey(['b', 'a'])).toBe(teamKey(['a', 'b']));
    expect(teamKey(['a'])).not.toBe(teamKey(['a', 'b']));
  });
});

describe('teamsInDraw / opponentsInDraw', () => {
  it('reads teams from standings and from knockout matches, once each', () => {
    const draw = {
      standings: [row('p1', 'p2'), row('p3', 'p4')],
      matches: [{ sides: [{ players: [{ player_id: 'p2' }, { player_id: 'p1' }] }, { players: [{ player_id: 'p5' }, { player_id: 'p6' }] }] }, { sides: [{}] }, {}],
    };
    expect(teamsInDraw(draw).map(teamKey)).toEqual(['p1+p2', 'p3+p4', 'p5+p6']);
  });

  it('tolerates a draw with neither standings nor matches', () => {
    expect(teamsInDraw({})).toEqual([]);
  });

  it("returns the player's own team and everyone else", () => {
    const draw = { standings: [row('p1', 'p2'), row('p3', 'p4'), row('p5', 'p6')] };
    expect(opponentsInDraw(draw, 'p2')).toEqual({ own: ['p1', 'p2'], opponents: [['p3', 'p4'], ['p5', 'p6']] });
  });

  it('has nothing to simulate when the player is not in the draw', () => {
    expect(opponentsInDraw({ standings: [row('p1'), row('p2')] }, 'p9')).toEqual({ own: null, opponents: [] });
  });
});

describe('playerEvents', () => {
  const tournament = {
    events: [
      { event_id: '11', name: 'Categorie 7 -  Heren Enkel', participants: [['p1'], ['p2']] },
      { event_id: '13', name: 'Categorie 7 -  Heren Dubbel', participants: [['p1', 'p2'], ['p3']] },
      { event_id: '12', name: 'Categorie 7 -  Dames Enkel', participants: [['p3']] },
      { event_id: '99', name: 'Categorie 7 -  Heren Dubbel', participants: undefined },
      { event_id: '98', name: 'Mystery', participants: [['p1']] },
    ],
  };

  it('lists every discipline the player is entered in, with their own entry', () => {
    expect(playerEvents(tournament, 'p1').map((e) => [e.event.event_id, e.discipline, e.entry])).toEqual([
      ['11', 'singles', ['p1']],
      ['13', 'doubles', ['p1', 'p2']],
    ]);
  });

  it('copes with a tournament without events or participants', () => {
    expect(playerEvents({}, 'p1')).toEqual([]);
    expect(playerEvents(undefined, 'p1')).toEqual([]);
  });
});

describe('eventHasDraw', () => {
  const event = { name: 'Categorie 7 -  Heren Enkel' };

  it.each([
    [[{ name: 'Categorie 7 - Heren Enkel' }], true],
    [[{ name: 'Categorie 7 - Heren Enkel - Groep A' }], true],
    [[{ name: 'Categorie 7 - Heren Enkel 2' }], false],
    [[{ name: 'Categorie 5 - Heren Enkel' }], false],
    [[], false],
    [undefined, false],
  ])('matches %j -> %s', (draws, expected) => {
    expect(eventHasDraw(event, draws)).toBe(expected);
  });
});

describe('completeTeams', () => {
  it('keeps single entries for singles and full pairs for doubles', () => {
    const event = { participants: [['a'], ['b', 'c'], ['d']] };
    expect(completeTeams(event, 'singles')).toEqual([['a'], ['d']]);
    expect(completeTeams(event, 'doubles')).toEqual([['b', 'c']]);
    expect(completeTeams({}, 'mixed')).toEqual([]);
  });
});

describe('shuffle', () => {
  const seeded = (...values) => { let i = 0; return () => values[i++ % values.length]; };

  it('keeps every item, does not mutate the input, and depends on the random source', () => {
    const items = [1, 2, 3, 4, 5];
    const a = shuffle(items, seeded(0.9, 0.1, 0.5, 0.3));
    const b = shuffle(items, seeded(0.1, 0.9, 0.2, 0.7));
    expect([...a].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(a).not.toEqual(b);
  });
});

describe('mockPoolFor', () => {
  const teams = (n) => Array.from({ length: n }, (_, i) => [`p${i}`]);

  it.each([
    [8, 2, [3, 4]], [13, 3, [3, 4]], [5, 1, [4, 4]], [2, 1, [1, 1]], [1, 1, [0, 0]],
  ])('deals %i teams into %i pool(s) with a sensible pool for the player', (count, poolCount, [minOpp, maxOpp]) => {
    const result = mockPoolFor(teams(count), ['p0']);
    expect(result.poolCount).toBe(poolCount);
    expect(result.opponents.length).toBeGreaterThanOrEqual(minOpp);
    expect(result.opponents.length).toBeLessThanOrEqual(maxOpp);
    expect(result.poolSize).toBe(result.opponents.length + 1);
  });

  it('never includes the player among their own opponents, nor repeats a team', () => {
    const { opponents } = mockPoolFor(teams(20), ['p3']);
    const keys = opponents.map(teamKey);
    expect(keys).not.toContain('p3');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is random: different random sources give different pools', () => {
    const seeded = (...v) => { let i = 0; return () => v[i++ % v.length]; };
    const a = mockPoolFor(teams(13), ['p0'], seeded(0.05, 0.95, 0.4, 0.6, 0.2)).opponents.map(teamKey);
    const b = mockPoolFor(teams(13), ['p0'], seeded(0.95, 0.05, 0.7, 0.1, 0.8)).opponents.map(teamKey);
    expect(a).not.toEqual(b);
  });

  it("adds the player's own team even when the list of teams lacks it", () => {
    const result = mockPoolFor([['a'], ['b']], ['me']);
    expect(result.poolSize).toBe(result.opponents.length + 1);
    expect(result.opponents.flat()).not.toContain('me');
  });
});
