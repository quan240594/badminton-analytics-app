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
  return import('./dataset.js');
}

function setCareer(raw) {
  files['career.json'] = JSON.stringify(raw);
}
function setRankings(raw) {
  files['rankings.json'] = JSON.stringify(raw);
}
function setTitles(raw) {
  files['titles.json'] = JSON.stringify(raw);
}

function match(overrides = {}) {
  return {
    tournament_id: 'T1',
    source_player_id: 'p1',
    event: 'MS',
    time: '01/03/2026 10:00',
    draw: 'Bondscompetitie \u2013 2e divisie \u2013 afd. 1',
    home_team: 'Home',
    away_team: 'Away',
    score: '21-10',
    winner_side: 'home',
    home_players: [['p1', 'Owner']],
    away_players: [['p2', 'Opp']],
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key];
  setRankings({ players: {}, top: {} });
});

describe('loadDataset', () => {
  it('builds players, canonical matches and resolves guids via the alias index', async () => {
    setCareer({
      g1: {
        name: 'Owner',
        club: 'C1',
        aliases: { 'T1:p1': { name: 'Owner', club: 'C1' } },
        matches: [match()],
      },
      g2: {
        name: 'Opp',
        club: 'C2',
        aliases: { 'T1:p2': { name: 'Opp', club: 'C2' } },
        matches: [],
      },
    });
    const { loadDataset } = await importFresh();

    const ds = loadDataset();

    expect(ds.players.get('g1')).toEqual({ id: 'g1', name: 'Owner', club: 'C1' });
    expect(ds.matches).toHaveLength(1);
    const m = ds.matches[0];
    expect(m.discipline).toBe('singles');
    expect(m.division).toBe('2e divisie');
    expect(m.home[0]).toEqual({ id: 'p1', name: 'Owner', guid: 'g1' });
    expect(m.away[0]).toEqual({ id: 'p2', name: 'Opp', guid: 'g2' });
    expect(m.timestamp).toBeTypeOf('number');
  });

  it('reconstructs the missing page-owner into whichever side is shorter', async () => {
    setCareer({
      g1: {
        name: 'Owner',
        club: null,
        aliases: {},
        matches: [
          match({
            event: 'MD',
            home_players: [['pX', 'Partner']],
            away_players: [['pY', 'A'], ['pZ', 'B']],
          }),
        ],
      },
    });
    const { loadDataset } = await importFresh();

    const ds = loadDataset();

    expect(ds.matches[0].discipline).toBe('doubles');
    expect(ds.matches[0].home.map((p) => p.id)).toEqual(['pX', 'p1']);
  });

  it('reconstructs the missing page-owner into the away side when it is not shorter', async () => {
    setCareer({
      g1: {
        name: 'Owner',
        club: null,
        aliases: {},
        matches: [
          match({
            event: 'MD',
            home_players: [['pX', 'A'], ['pY', 'B']],
            away_players: [['pZ', 'Partner']],
          }),
        ],
      },
    });
    const { loadDataset } = await importFresh();

    const ds = loadDataset();

    expect(ds.matches[0].away.map((p) => p.id)).toEqual(['pZ', 'p1']);
  });

  it('drops matches whose discipline cannot be resolved from an unrecognized event with a non-2 roster', async () => {
    setCareer({
      g1: {
        name: 'Owner',
        club: null,
        aliases: {},
        matches: [
          match({ event: 'ZZ', home_players: [['p1', 'Owner']], away_players: [['pY', 'A'], ['pZ', 'B']] }),
        ],
      },
    });
    const { loadDataset } = await importFresh();
    expect(loadDataset().matches).toHaveLength(0);
  });

  it('falls back to singles for an unrecognized event code with a 1v1 roster', async () => {
    setCareer({
      g1: { name: 'Owner', club: null, aliases: {}, matches: [match({ event: 'ZZ' })] },
    });
    const { loadDataset } = await importFresh();
    expect(loadDataset().matches[0].discipline).toBe('singles');
  });

  it('drops doubles/mixed matches whose roster size does not match the discipline', async () => {
    setCareer({
      g1: {
        name: 'Owner',
        club: null,
        aliases: {},
        matches: [match({ event: 'MD', home_players: [['p1', 'Owner']], away_players: [['pY', 'A']] })],
      },
    });
    const { loadDataset } = await importFresh();
    expect(loadDataset().matches).toHaveLength(0);
  });

  it('deduplicates the same match seen from both participants\' pages', async () => {
    const shared = match();
    setCareer({
      g1: { name: 'Owner', club: null, aliases: {}, matches: [shared] },
      g2: { name: 'Opp', club: null, aliases: {}, matches: [shared] },
    });
    const { loadDataset } = await importFresh();
    expect(loadDataset().matches).toHaveLength(1);
  });

  it('sorts matches by timestamp and treats an unparsable time as 0', async () => {
    setCareer({
      g1: {
        name: 'Owner',
        club: null,
        aliases: {},
        matches: [
          match({ tournament_id: 'T2', time: 'not-a-date', home_team: 'H2' }),
          match({ tournament_id: 'T1', time: '01/03/2026 10:00', home_team: 'H1' }),
        ],
      },
    });
    const { loadDataset } = await importFresh();
    const ds = loadDataset();
    expect(ds.matches[0].homeTeam).toBe('H2');
    expect(ds.matches[0].timestamp).toBeNull();
    expect(ds.matches[1].homeTeam).toBe('H1');
  });

  it('parses a null division when the draw label has no separator', async () => {
    setCareer({
      g1: { name: 'Owner', club: null, aliases: {}, matches: [match({ draw: 'NoSeparatorHere' })] },
    });
    const { loadDataset } = await importFresh();
    expect(loadDataset().matches[0].division).toBeNull();
  });

  it('resolves highestDivisionPlayed by lowest rank, breaking ties by most recent year', async () => {
    const aliasesFor = (tid) => ({ [`${tid}:p1`]: { name: 'Owner', club: null } });
    setCareer({
      g1: {
        name: 'Owner',
        club: null,
        aliases: { ...aliasesFor('T1'), ...aliasesFor('T2'), ...aliasesFor('T3'), ...aliasesFor('T4') },
        matches: [
          match({ tournament_id: 'T1', draw: 'X \u2013 Eredivisie \u2013 afd. 1', time: '01/03/2024 10:00' }),
          match({ tournament_id: 'T2', draw: 'X \u2013 Onbekend \u2013 afd. 1', time: '01/03/2025 10:00' }),
          match({ tournament_id: 'T3', draw: 'X \u2013 1e divisie \u2013 afd. 1', time: '01/03/2020 10:00' }),
          match({ tournament_id: 'T4', draw: 'X \u2013 1e divisie \u2013 afd. 1', time: '01/03/2023 10:00' }),
        ],
      },
    });
    const { loadDataset } = await importFresh();
    const ds = loadDataset();
    const best = ds.highestDivisionPlayed(ds.matches, 'g1');
    expect(best).toEqual({ division: 'Eredivisie', year: 2024 });
  });

  it('returns null from highestDivisionPlayed when the guid never played', async () => {
    setCareer({ g1: { name: 'Owner', club: null, aliases: {}, matches: [match()] } });
    const { loadDataset } = await importFresh();
    const ds = loadDataset();
    expect(ds.highestDivisionPlayed(ds.matches, 'nobody')).toBeNull();
  });

  it('resolves national rankings by alias and excludes unresolvable local ids', async () => {
    setCareer({
      g1: { name: 'Owner', club: null, aliases: { '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E:local1': {} }, matches: [] },
    });
    setRankings({
      players: {
        local1: { singles: { rank: 3, points: 900 } },
        localOrphan: { singles: { rank: 9, points: 100 } },
      },
      top: { singles: { name: 'Top', points: 1000 } },
    });
    const { loadDataset } = await importFresh();
    const ds = loadDataset();
    expect(ds.rankings.has('g1')).toBe(true);
    expect(ds.rankings.has('localOrphan')).toBe(false);
    expect(ds.rankingTop).toEqual({ singles: { name: 'Top', points: 1000 } });
  });

  it('defaults titles to empty when titles.json is missing or malformed', async () => {
    setCareer({ g1: { name: 'Owner', club: null, aliases: {}, matches: [] } });
    const { loadDataset } = await importFresh();
    const ds = loadDataset();
    expect(ds.titlesForPlayer('g1')).toEqual({ singles: null, doubles: null, mixed: null });
    expect(ds.titleYears).toEqual([]);
  });

  it('picks the best title per category, tie-breaking by most recent year, and tallies medal counts excluding noguid entries', async () => {
    setCareer({ g1: { name: 'Owner', club: null, aliases: {}, matches: [] } });
    setTitles({
      g1: [
        { category: 'singles', status: 'Finalist', tournament: 'Open A', year: 2024 },
        { category: 'singles', status: 'Winner', tournament: 'Open B', year: 2023 },
        { category: 'singles', status: 'Winner', tournament: 'Open C', year: 2025 },
        { category: 'doubles', status: 'Semi-finalist', tournament: 'Open D', year: 2024 },
        { category: null, status: 'Winner', tournament: 'Ignored', year: 2024 },
      ],
      'noguid:Someone': [{ category: 'singles', status: 'Winner', tournament: 'Open E', year: 2024 }],
    });
    const { loadDataset } = await importFresh();
    const ds = loadDataset();

    expect(ds.titlesForPlayer('g1').singles).toEqual({ status: 'Winner', tournament: 'Open C', year: 2025 });
    expect(ds.titlesForPlayer('g1').mixed).toBeNull();
    expect(ds.titleYears).toEqual([2023, 2024, 2025]);

    const counts = ds.titleCounts('g1');
    expect(counts.total).toEqual({ gold: 3, silver: 1, bronze: 1 });
    expect(counts.byYear[2024]).toEqual({ gold: 1, silver: 1, bronze: 1 });
  });
});
