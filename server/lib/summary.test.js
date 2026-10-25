import { describe, it, expect, vi } from 'vitest';

vi.mock('./season.js', () => ({ currentSeasonLabel: vi.fn(() => '2026-2027') }));
vi.mock('./leagueIndex.js', () => ({
  fullLeagueIndex: vi.fn(() => ({ regions: [], divisions: {} })),
  currentPoolTeams: vi.fn((label) => ({ drawId: '12', label, teams: [] })),
  fetchedDrawIds: vi.fn((id) => [id]),
  poolRosters: vi.fn(() => ({ 12: ['g1'] })),
  substitutePlayerIds: vi.fn(() => ['g2']),
  playerGenders: vi.fn(() => ({ g1: 'M' })),
}));

const {
  CURRENT_POOL_LABEL, confidenceLabel, winRate, careerBucket, disciplineFields,
  playerSummary, listPlayerSummaries, poolMeta,
} = await import('./summary.js');

const TOURNAMENT = '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E';

function makeContext() {
  return {
    players: new Map([
      ['g1', { name: 'Bob', club: 'C1' }],
      ['g2', { name: 'Alice', club: 'C2' }],
      ['g3', { name: 'Zoe', club: 'C3' }],
    ]),
    matches: [],
    singles: new Map([['g1', { rating: 1600.4, played: 20 }]]),
    doublesPlayer: new Map([['g1', { rating: 1550, played: 8 }]]),
    mixedPlayer: new Map(),
    careerStats: new Map([
      ['g1', { singles: { played: 20, won: 10, setsPlayed: 40, setsWon: 22, pointsPlayed: 800, pointsWon: 420 } }],
    ]),
    rankings: new Map([['g1', { singles: { rank: 1, points: 500 } }]]),
    rankingTop: { singles: { name: 'Top', points: 1000 } },
    highestDivisionPlayed: vi.fn(() => ({ division: 'Eredivisie', year: 2025 })),
    titlesForPlayer: vi.fn(() => ({ singles: null })),
    titleCounts: vi.fn(() => ({ total: { gold: 0, silver: 0, bronze: 0 } })),
  };
}

describe('confidenceLabel', () => {
  it.each([
    [0, 'low'], [4, 'low'], [5, 'medium'], [14, 'medium'], [15, 'high'], [99, 'high'],
  ])('labels %i played matches as %s', (played, label) => {
    expect(confidenceLabel(played)).toBe(label);
  });
});

describe('winRate', () => {
  it('is null with nothing played, otherwise won/played', () => {
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(1, 4)).toBe(0.25);
  });
});

describe('careerBucket', () => {
  it('returns the stored bucket or an all-zero default', () => {
    const stats = new Map([['g1', { singles: { played: 3 } }]]);
    expect(careerBucket(stats, 'g1', 'singles')).toEqual({ played: 3 });
    expect(careerBucket(stats, 'g1', 'doubles')).toMatchObject({ played: 0, won: 0, pointsWon: 0 });
    expect(careerBucket(stats, 'nobody', 'singles')).toMatchObject({ played: 0 });
  });
});

describe('disciplineFields', () => {
  it('rounds the rating, defaults to 1500 and derives win rates', () => {
    const career = { played: 4, won: 1, setsPlayed: 0, setsWon: 0, pointsPlayed: 10, pointsWon: 5 };
    expect(disciplineFields('mixed', undefined, career)).toMatchObject({
      mixedRating: 1500, mixedWinRate: 0.25, mixedSetsWinRate: null, mixedPointsWinRate: 0.5,
    });
    expect(disciplineFields('mixed', 1612.6, career).mixedRating).toBe(1613);
  });
});

describe('playerSummary', () => {
  it('returns null for an unknown guid', () => {
    expect(playerSummary(makeContext(), 'nope')).toBeNull();
  });

  it('builds the per-discipline summary without confidence labels by default', () => {
    const summary = playerSummary(makeContext(), 'g1');

    expect(summary).toMatchObject({ id: 'g1', name: 'Bob', club: 'C1', singlesRating: 1600, singlesWinRate: 0.5 });
    expect(summary.nationalRanking.singles).toMatchObject({ rank: 1, pctOfTop: 0.5 });
    expect(summary.highestDivision).toEqual({ division: 'Eredivisie', year: 2025 });
    expect(summary).not.toHaveProperty('singlesConfidence');
  });

  it('adds confidence labels from the rating book when asked', () => {
    const summary = playerSummary(makeContext(), 'g1', { withConfidence: true });

    expect([summary.singlesConfidence, summary.doublesConfidence, summary.mixedConfidence])
      .toEqual(['high', 'medium', 'low']);
  });
});

describe('listPlayerSummaries', () => {
  it('keeps players with matches or a current-season alias, sorted by name', () => {
    const aliasIndex = new Map([[`${TOURNAMENT}:local2`, 'g2'], ['other-tournament:local3', 'g3']]);

    const list = listPlayerSummaries(makeContext(), aliasIndex);

    expect(list.map((p) => p.id)).toEqual(['g2', 'g1']);
  });
});

describe('poolMeta', () => {
  it('combines the pool label with the league-index lookups', () => {
    const meta = poolMeta(new Map(), [2024]);

    expect(meta.poolLabel).toBe(CURRENT_POOL_LABEL);
    expect(CURRENT_POOL_LABEL).toBe('Bondscompetitie 2026-2027 \u2013 Mannen Veer 2 afd. 12');
    expect(meta).toMatchObject({
      titleYears: [2024],
      currentPool: { drawId: '12' },
      fetchedDrawIds: ['12'],
      poolRosters: { 12: ['g1'] },
      substitutePlayerIds: ['g2'],
      playerGenders: { g1: 'M' },
    });
  });
});
