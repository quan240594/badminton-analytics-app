import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = {};

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path) => Object.keys(files).some((k) => String(path).endsWith(k))),
  readFileSync: vi.fn((path) => {
    const key = Object.keys(files).find((k) => String(path).endsWith(k));
    return files[key];
  }),
}));

async function importFresh() {
  vi.resetModules();
  return import('./tournaments.js');
}

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key];
});

describe('buildTournaments', () => {
  it('returns an empty list when no tournament files exist', async () => {
    const { buildTournaments } = await importFresh();
    expect(buildTournaments()).toEqual([]);
  });

  it('folds tournaments/details/draws/rankings into a sorted bundle', async () => {
    files['tournaments.json'] = JSON.stringify({
      t1: { name: 'Zeta Open', club: 'BC Zeta', location: 'Utrecht', dates: ['2026-01-01'] },
      t2: { name: 'Alpha Open' },
    });
    files['tournament_details.json'] = JSON.stringify({
      t1: {
        entries: [{ player_id: 'p1', name: 'Player One', country: 'NL' }],
        events: ['MS'],
        draws: [{ draw_id: 'd1', name: 'Draw 1' }],
      },
      t2: { entries: [{ player_id: 'p2', name: 'Player Two', country: 'BE' }] },
    });
    files['tournament_draws_data.json'] = JSON.stringify({
      t1: {
        d1: {
          standings: [{ rank: 1 }],
          matches: [
            {
              sides: [{ players: [{ player_id: 'p1', member_id: 'm1' }] }],
            },
          ],
        },
      },
    });
    files['rankings.json'] = JSON.stringify({
      players: { m1: { singles: { rank: 5, points: 1000 } } },
      top: { singles: { points: 2000, name: 'Top Player' } },
    });

    const { buildTournaments } = await importFresh();
    const result = buildTournaments();

    expect(result.map((t) => t.name)).toEqual(['Alpha Open', 'Zeta Open']);
    const zeta = result.find((t) => t.id === 't1');
    expect(zeta.club).toBe('BC Zeta');
    expect(zeta.players[0].nationalRanking.singles).toEqual({
      rank: 5,
      points: 1000,
      topPoints: 2000,
      topName: 'Top Player',
      pctOfTop: 0.5,
    });
    expect(zeta.players[0].nationalRanking.doubles).toBeNull();
    expect(zeta.draws[0].standings).toEqual([{ rank: 1 }]);

    const alpha = result.find((t) => t.id === 't2');
    expect(alpha.name).toBe('Alpha Open');
    expect(alpha.club).toBeNull();
    expect(alpha.players[0].nationalRanking).toBeNull();
  });

  it('falls back to the tournament id as name when meta is missing', async () => {
    files['tournament_details.json'] = JSON.stringify({ t9: {} });

    const { buildTournaments } = await importFresh();
    const result = buildTournaments();

    expect(result[0]).toMatchObject({ id: 't9', name: 't9', players: [], draws: [], events: [] });
  });

  it('falls back to defaults when a JSON file is malformed', async () => {
    files['tournaments.json'] = '{not valid json';

    const { buildTournaments } = await importFresh();
    expect(buildTournaments()).toEqual([]);
  });
});

describe('buildTournaments - sparse draw data', () => {
  it('defaults standings/matches for draws missing from the draw data and tolerates matches without sides or players', async () => {
    files['tournament_details.json'] = JSON.stringify({
      t1: { draws: [{ draw_id: 'd1' }, { draw_id: 'd2' }, { draw_id: 'd3' }] },
    });
    files['tournament_draws_data.json'] = JSON.stringify({
      t1: {
        d1: { matches: [{}, { sides: [{}] }] },
        d3: { standings: [{ rank: 1 }] },
      },
    });

    const { buildTournaments } = await importFresh();
    const [{ draws }] = buildTournaments();

    expect(draws.map((d) => [d.standings, d.matches])).toEqual([
      [[], [{}, { sides: [{}] }]],
      [[], []],
      [[{ rank: 1 }], []],
    ]);
  });
});

describe('nameKey', () => {
  it.each([
    ['Do, Quan', 'Quan Do'],
    ['Nguyen, Dung Vu Tien', 'Vu Tien Dung (Ben) Nguyen'],
    ['Dulk, Dieudonn\u00e9e Den', 'Dieudonnee Den Dulk'],
    ['Lee, Doris van der', 'Doris van der Lee'],
  ])('treats %s and %s as the same name', async (a, b) => {
    const { nameKey } = await importFresh();
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it('keeps different people apart and tolerates missing names', async () => {
    const { nameKey } = await importFresh();
    expect(nameKey('Do, Quan')).not.toBe(nameKey('Do, Quang'));
    expect(nameKey(undefined)).toBe('');
  });
});

describe('buildTournaments - league ranking by name', () => {
  const ranking = { singles: { rank: 7, points: 500, topPoints: 1000, topName: 'Top', pctOfTop: 0.5 }, doubles: null, mixed: null };
  const unranked = { singles: null, doubles: null, mixed: null };

  function setup(entries, draws) {
    files['tournaments.json'] = JSON.stringify({ t1: { name: 'Open' } });
    files['tournament_details.json'] = JSON.stringify({ t1: { entries, draws: [{ draw_id: 'd1', name: 'HE' }] } });
    files['tournament_draws_data.json'] = JSON.stringify(draws ? { t1: { d1: draws } } : {});
    files['rankings.json'] = JSON.stringify({ players: { m1: { singles: { rank: 2, points: 900 } } }, top: { singles: { points: 1800, name: 'Top' } } });
  }

  it('gives an entrant the ranking of the one league player with the same name', async () => {
    setup([{ player_id: 'p1', name: 'Do, Quan' }]);
    const { buildTournaments } = await importFresh();
    const [t] = buildTournaments([{ name: 'Quan Do', nationalRanking: ranking }]);
    expect(t.players[0].nationalRanking).toEqual(ranking);
  });

  it('does not guess when two league players share the name', async () => {
    setup([{ player_id: 'p1', name: 'Do, Quan' }]);
    const { buildTournaments } = await importFresh();
    const [t] = buildTournaments([
      { name: 'Quan Do', nationalRanking: ranking },
      { name: 'Do Quan', nationalRanking: unranked },
    ]);
    expect(t.players[0].nationalRanking).toBeNull();
  });

  it('leaves entrants without a namesake, or whose namesake is unranked, without ranking data', async () => {
    setup([{ player_id: 'p1', name: 'Nobody, Known' }, { player_id: 'p2', name: 'Nguyen, Ben' }]);
    const { buildTournaments } = await importFresh();
    const [t] = buildTournaments([{ name: 'Ben Nguyen', nationalRanking: unranked }]);
    expect(t.players[0].nationalRanking).toBeNull();
    expect(t.players[1].nationalRanking).toBeNull();
  });

  it('prefers the ranking derived from match data over the name match', async () => {
    setup(
      [{ player_id: 'p1', name: 'Do, Quan' }],
      { standings: [], matches: [{ sides: [{ players: [{ player_id: 'p1', member_id: 'm1' }] }] }] },
    );
    const { buildTournaments } = await importFresh();
    const [t] = buildTournaments([{ name: 'Quan Do', nationalRanking: ranking }]);
    expect(t.players[0].nationalRanking.singles.rank).toBe(2);
  });
});
