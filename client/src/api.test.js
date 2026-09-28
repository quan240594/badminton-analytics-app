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
