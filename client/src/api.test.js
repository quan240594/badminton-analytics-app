import { describe, it, expect, beforeEach, vi } from 'vitest';

// api.js caches the fetched bundle in a module-level singleton, so each test
// needs a fresh module instance to control/observe its own fetch call.
async function freshApi() {
  vi.resetModules();
  return import('./api.js');
}

describe('loadBundle (via fetchPlayers/fetchMeta)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns players from the data bundle', async () => {
    const players = [{ id: 'p1', name: 'Test Player' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ players, meta: { generatedAt: '2026-01-01' } }),
    });

    const { fetchPlayers } = await freshApi();
    await expect(fetchPlayers()).resolves.toEqual(players);
  });

  it('caches the bundle so concurrent readers only trigger one fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ players: [], meta: {} }),
    });

    const { fetchPlayers, fetchMeta } = await freshApi();
    await fetchPlayers();
    await fetchMeta();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects when the bundle request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const { fetchPlayers } = await freshApi();
    await expect(fetchPlayers()).rejects.toThrow('Failed to load data.json: 404');
  });
});


describe('simulateTournamentMatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockBundle(players) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        players: [],
        meta: {},
        tournaments: [{ id: 't1', name: 'Test Open', players }],
      }),
    });
  }

  it('simulates using national ranking points when both players have data', async () => {
    mockBundle([
      { id: 'p1', name: 'Alice', nationalRanking: { singles: { rank: 10, points: 900, topPoints: 1000, pctOfTop: 0.9 } } },
      { id: 'p2', name: 'Bob', nationalRanking: { singles: { rank: 50, points: 400, topPoints: 1000, pctOfTop: 0.4 } } },
    ]);
    const { simulateTournamentMatch } = await freshApi();
    const result = await simulateTournamentMatch('t1', 'singles', 'p1', 'p2');
    expect(result.error).toBeUndefined();
    expect(result.winProbabilityA).toBeGreaterThan(0.5);
    expect(result.winProbabilityA + result.winProbabilityB).toBeCloseTo(1);
  });

  it('refuses to simulate when one player has no national ranking data', async () => {
    mockBundle([
      { id: 'p1', name: 'Alice', nationalRanking: { singles: { rank: 10, points: 900, topPoints: 1000, pctOfTop: 0.9 } } },
      { id: 'p2', name: 'Cara', nationalRanking: null },
    ]);
    const { simulateTournamentMatch } = await freshApi();
    const result = await simulateTournamentMatch('t1', 'singles', 'p1', 'p2');
    expect(result.error).toBe(true);
    expect(result.message).toBe('Cara has no national ranking data to simulate this match with.');
  });

  it('refuses to simulate when neither player has national ranking data', async () => {
    mockBundle([
      { id: 'p1', name: 'Dan', nationalRanking: null },
      { id: 'p2', name: 'Cara', nationalRanking: null },
    ]);
    const { simulateTournamentMatch } = await freshApi();
    const result = await simulateTournamentMatch('t1', 'singles', 'p1', 'p2');
    expect(result.error).toBe(true);
    expect(result.message).toBe('Dan and Cara have no national ranking data to simulate this match with.');
  });

  it('refuses to simulate when a player has ranking data in another discipline only', async () => {
    mockBundle([
      { id: 'p1', name: 'Alice', nationalRanking: { singles: { rank: 10, points: 900, topPoints: 1000, pctOfTop: 0.9 }, doubles: null } },
      { id: 'p2', name: 'Bob', nationalRanking: { singles: null, doubles: { rank: 5, points: 950, topPoints: 1000, pctOfTop: 0.95 } } },
    ]);
    const { simulateTournamentMatch } = await freshApi();
    const result = await simulateTournamentMatch('t1', 'doubles', 'p1', 'p2');
    expect(result.error).toBe(true);
    expect(result.message).toBe('Alice has no national ranking data to simulate this match with.');
  });
});
