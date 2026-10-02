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
