import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = {};

vi.mock('node:fs', () => ({
  readFileSync: vi.fn((path) => {
    const key = Object.keys(files).find((k) => String(path).endsWith(k));
    if (key === undefined) throw new Error(`ENOENT: ${path}`);
    return files[key];
  }),
}));

async function importFresh() {
  vi.resetModules();
  return import('./leagueIndex.js');
}

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key];
});

describe('fullLeagueIndex', () => {
  it('splits each team name into club + squad code', async () => {
    files['league_index.json'] = JSON.stringify({
      regions: ['Noord'],
      divisions: {
        '2e divisie': [
          {
            drawId: '12',
            division: '2e divisie',
            label: '2e divisie \u2013 afd. 12',
            teams: [
              { clubId: 'c1', name: 'BC Foo M1' },
              { clubId: 'c2', name: 'No Squad Code Here' },
            ],
          },
        ],
      },
    });
    const { fullLeagueIndex } = await importFresh();

    const result = fullLeagueIndex();

    expect(result.regions).toEqual(['Noord']);
    expect(result.divisions['2e divisie'][0].teams[0]).toEqual({ clubId: 'c1', club: 'BC Foo', squad: 'M1' });
    expect(result.divisions['2e divisie'][0].teams[1]).toEqual({ clubId: 'c2', club: 'No Squad Code Here', squad: null });
  });

  it('falls back to empty regions/divisions when the file is unreadable', async () => {
    const { fullLeagueIndex } = await importFresh();
    expect(fullLeagueIndex()).toEqual({ regions: [], divisions: {} });
  });
});

describe('currentPoolTeams', () => {
  it('finds the afdeling matching the label suffix', async () => {
    files['league_index.json'] = JSON.stringify({
      regions: [],
      divisions: {
        Veer: [{ drawId: '99', division: 'Veer', label: 'Veer 2 afd. 12', teams: [] }],
      },
    });
    const { currentPoolTeams } = await importFresh();

    const result = currentPoolTeams('Bondscompetitie 2026-2027 \u2013 Veer 2 afd. 12');

    expect(result.drawId).toBe('99');
  });

  it('returns a null-drawId placeholder when no afdeling matches', async () => {
    files['league_index.json'] = JSON.stringify({ regions: [], divisions: {} });
    const { currentPoolTeams } = await importFresh();

    const result = currentPoolTeams('Bondscompetitie 2026-2027 \u2013 Veer 2 afd. 12');

    expect(result).toEqual({ drawId: null, label: 'Veer 2 afd. 12', teams: [] });
  });
});

describe('fetchedDrawIds', () => {
  it('includes fetched pools plus the always-included id', async () => {
    files['fetched_pools.json'] = JSON.stringify({ 1: {}, 2: {} });
    const { fetchedDrawIds } = await importFresh();

    expect(fetchedDrawIds(3).sort()).toEqual(['1', '2', '3']);
  });

  it('defaults to an empty set when the file is unreadable and no id given', async () => {
    const { fetchedDrawIds } = await importFresh();
    expect(fetchedDrawIds(undefined)).toEqual([]);
  });
});

describe('poolRosters', () => {
  it('resolves local ids through the alias index and drops unresolved ones', async () => {
    files['pool_rosters.json'] = JSON.stringify({ 12: ['p1', 'p2'] });
    const { poolRosters } = await importFresh();
    const aliasIndex = new Map([['9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E:p1', 'guid-1']]);

    expect(poolRosters(aliasIndex)).toEqual({ 12: ['guid-1'] });
  });

  it('defaults to an empty object when the file is unreadable', async () => {
    const { poolRosters } = await importFresh();
    expect(poolRosters(new Map())).toEqual({});
  });
});

describe('substitutePlayerIds', () => {
  it('includes only guids marked not-fixed and resolvable', async () => {
    files['player_fixed_status.json'] = JSON.stringify({
      p1: { fixed: true, gender: 'M' },
      p2: { fixed: false, gender: 'F' },
      p3: { fixed: false, gender: 'M' },
    });
    const { substitutePlayerIds } = await importFresh();
    const aliasIndex = new Map([['9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E:p2', 'guid-2']]);

    expect(substitutePlayerIds(aliasIndex)).toEqual(['guid-2']);
  });

  it('defaults to an empty array when the file is unreadable', async () => {
    const { substitutePlayerIds } = await importFresh();
    expect(substitutePlayerIds(new Map())).toEqual([]);
  });
});

describe('playerGenders', () => {
  it('maps resolvable guids to their recorded gender', async () => {
    files['player_fixed_status.json'] = JSON.stringify({
      p1: { fixed: true, gender: 'M' },
    });
    const { playerGenders } = await importFresh();
    const aliasIndex = new Map([['9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E:p1', 'guid-1']]);

    expect(playerGenders(aliasIndex)).toEqual({ 'guid-1': 'M' });
  });

  it('defaults to an empty object when the file is unreadable', async () => {
    const { playerGenders } = await importFresh();
    expect(playerGenders(new Map())).toEqual({});
  });
});

describe('leagueIndex without data', () => {
  it('defaults to empty regions/divisions when the index file lacks them', async () => {
    files['league_index.json'] = '{}';
    const { fullLeagueIndex } = await importFresh();

    expect(fullLeagueIndex()).toEqual({ regions: [], divisions: {} });
  });

  it('returns an unlabelled empty pool when the pool label has no division separator', async () => {
    files['league_index.json'] = '{}';
    const { currentPoolTeams } = await importFresh();

    expect(currentPoolTeams('Just a label')).toEqual({ drawId: null, label: null, teams: [] });
  });
});
