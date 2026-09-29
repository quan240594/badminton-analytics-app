import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:fs', () => ({
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('./lib/dataset.js', () => ({
  loadDataset: vi.fn(() => ({
    players: new Map([
      ['g1', { name: 'Bob', club: 'C1' }],
      ['g2', { name: 'Alice', club: 'C2' }],
      ['g3', { name: 'Zoe', club: 'C3' }],
    ]),
    matches: [],
    rankings: new Map([['g1', { singles: { rank: 1, points: 500 } }]]),
    rankingTop: { singles: { name: 'Top', points: 1000 } },
    highestDivisionPlayed: vi.fn(() => ({ division: 'Eredivisie', year: 2025 })),
    titlesForPlayer: vi.fn(() => ({ singles: null, doubles: null, mixed: null })),
    titleCounts: vi.fn(() => ({ byYear: {}, total: { gold: 0, silver: 0, bronze: 0 } })),
    titleYears: [2024, 2025],
    aliasIndex: new Map([
      ['9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E:local1', 'g1'],
      ['9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E:local2', 'g2'],
    ]),
  })),
}));

vi.mock('./lib/elo.js', () => ({
  computeRatings: vi.fn(() => ({
    singles: new Map([['g1', { rating: 1600, played: 20 }]]),
    doublesPlayer: new Map([['g1', { rating: 1550, played: 8 }]]),
    mixedPlayer: new Map([['g1', { rating: 1500, played: 2 }]]),
    singlesH2H: new Map([['g1|g2', { wins: 1, losses: 0 }]]),
    doublesPairH2H: new Map(),
    mixedPairH2H: new Map(),
  })),
}));

vi.mock('./lib/stats.js', () => ({
  computeCareerStats: vi.fn(() => new Map([
    ['g1', { singles: { played: 20, won: 10, setsPlayed: 40, setsWon: 22, pointsPlayed: 800, pointsWon: 420 } }],
  ])),
}));

vi.mock('./lib/season.js', () => ({ currentSeasonLabel: vi.fn(() => '2026-2027') }));

vi.mock('./lib/leagueIndex.js', () => ({
  fullLeagueIndex: vi.fn(() => ({ regions: [], divisions: {} })),
  currentPoolTeams: vi.fn(() => ({ drawId: '12', label: 'afd. 12', teams: [] })),
  fetchedDrawIds: vi.fn(() => ['12']),
  poolRosters: vi.fn(() => ({})),
  substitutePlayerIds: vi.fn(() => []),
  playerGenders: vi.fn(() => ({})),
}));

vi.mock('./lib/tournaments.js', () => ({ buildTournaments: vi.fn(() => []) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('build-static bundle generation', () => {
  it('writes a sorted, filtered player bundle with derived rating/win-rate fields', async () => {
    await import('./build-static.js');

    expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [outPath, json] = writeFileSyncMock.mock.calls[0];
    expect(outPath).toMatch(/data\.json$/);
    const bundle = JSON.parse(json);

    expect(bundle.players.map((p) => p.id)).toEqual(['g2', 'g1']);

    const bob = bundle.players.find((p) => p.id === 'g1');
    expect(bob.singlesRating).toBe(1600);
    expect(bob.singlesWinRate).toBe(0.5);
    expect(bob.singlesSetsWinRate).toBe(0.55);
    expect(bob.singlesPointsWinRate).toBe(0.525);
    expect(bob.singlesConfidence).toBe('high');
    expect(bob.doublesConfidence).toBe('medium');
    expect(bob.mixedConfidence).toBe('low');
    expect(bob.mixedRating).toBe(1500);
    expect(bob.nationalRanking.singles).toEqual({
      rank: 1, points: 500, topPoints: 1000, topName: 'Top', pctOfTop: 0.5,
    });
    expect(bob.nationalRanking.doubles).toBeNull();
    expect(bob.highestDivision).toEqual({ division: 'Eredivisie', year: 2025 });

    const alice = bundle.players.find((p) => p.id === 'g2');
    expect(alice.singlesRating).toBe(1500);
    expect(alice.singlesWinRate).toBeNull();
    expect(alice.singlesConfidence).toBe('low');
    expect(alice.nationalRanking.singles).toBeNull();

    expect(bundle.meta.poolLabel).toBe('Bondscompetitie 2026-2027 \u2013 Mannen Veer 2 afd. 12');
    expect(bundle.meta.playerCount).toBe(2);
    expect(bundle.meta.titleYears).toEqual([2024, 2025]);
    expect(bundle.singlesH2H).toEqual({ 'g1|g2': { wins: 1, losses: 0 } });
    expect(bundle.tournaments).toEqual([]);
  });
});
