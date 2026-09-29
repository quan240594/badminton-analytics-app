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

describe('local-dev refresh endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('triggerRefresh resolves on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { triggerRefresh } = await freshApi();
    await expect(triggerRefresh()).resolves.toBeUndefined();
  });

  it('triggerRefresh throws a specific message on 409', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    const { triggerRefresh } = await freshApi();
    await expect(triggerRefresh()).rejects.toThrow('A refresh is already in progress.');
  });

  it('triggerRefresh throws a generic message on other failures', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { triggerRefresh } = await freshApi();
    await expect(triggerRefresh()).rejects.toThrow('Could not reach the local refresh server (500).');
  });

  it('fetchRefreshProgress returns the parsed progress json', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ running: true, percent: 40 }) });
    const { fetchRefreshProgress } = await freshApi();
    await expect(fetchRefreshProgress()).resolves.toEqual({ running: true, percent: 40 });
  });

  it('fetchClubDraws encodes the club name and returns the draws array', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ draws: ['12'] }) });
    const { fetchClubDraws } = await freshApi();
    await expect(fetchClubDraws('BC Foo/Bar')).resolves.toEqual(['12']);
    expect(global.fetch).toHaveBeenCalledWith('/api/clubs/BC%20Foo%2FBar/draws');
  });

  it('triggerPoolRefresh posts the drawId and resolves on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const { triggerPoolRefresh } = await freshApi();
    await expect(triggerPoolRefresh('12')).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith('/api/refresh/pool', expect.objectContaining({ method: 'POST' }));
  });

  it('triggerPoolRefresh throws a specific message on 409', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    const { triggerPoolRefresh } = await freshApi();
    await expect(triggerPoolRefresh('12')).rejects.toThrow('A refresh is already in progress.');
  });

  it('triggerPoolRefresh throws a generic message on other failures', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { triggerPoolRefresh } = await freshApi();
    await expect(triggerPoolRefresh('12')).rejects.toThrow('Could not reach the local refresh server (500).');
  });

  it('fetchPoolRefreshProgress returns the parsed progress json', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ running: false }) });
    const { fetchPoolRefreshProgress } = await freshApi();
    await expect(fetchPoolRefreshProgress()).resolves.toEqual({ running: false });
  });

  it('reloadBundle cache-busts and replaces the cached bundle', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ players: ['fresh'] }) });
    const { reloadBundle, fetchPlayers } = await freshApi();
    await reloadBundle();
    await expect(fetchPlayers()).resolves.toEqual(['fresh']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/^\/data\.json\?t=\d+$/);
  });

  it('reloadBundle rejects when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { reloadBundle } = await freshApi();
    await expect(reloadBundle()).rejects.toThrow('Failed to load data.json: 500');
  });
});

describe('GitHub Actions workflow refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('prompts for a token, stores it, and dispatches the workflow', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('gh-token-1');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const { triggerGithubWorkflowRefresh } = await freshApi();

    const dispatchedAt = await triggerGithubWorkflowRefresh();

    expect(typeof dispatchedAt).toBe('string');
    expect(sessionStorage.getItem('badminton-app-gh-token')).toBe('gh-token-1');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/dispatches'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reuses an already-stored token without prompting', async () => {
    sessionStorage.setItem('badminton-app-gh-token', 'stored-token');
    const promptSpy = vi.spyOn(window, 'prompt');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const { triggerGithubWorkflowRefresh } = await freshApi();

    await triggerGithubWorkflowRefresh();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('throws when the user declines to provide a token', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { triggerGithubWorkflowRefresh } = await freshApi();
    await expect(triggerGithubWorkflowRefresh()).rejects.toThrow('A GitHub token is required');
  });

  it('clears the stored token and throws when GitHub rejects it', async () => {
    sessionStorage.setItem('badminton-app-gh-token', 'bad-token');
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const { triggerGithubWorkflowRefresh } = await freshApi();

    await expect(triggerGithubWorkflowRefresh()).rejects.toThrow('GitHub rejected that token');
    expect(sessionStorage.getItem('badminton-app-gh-token')).toBeNull();
  });

  it('throws a generic error for other dispatch failures', async () => {
    sessionStorage.setItem('badminton-app-gh-token', 'tok');
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { triggerGithubWorkflowRefresh } = await freshApi();
    await expect(triggerGithubWorkflowRefresh()).rejects.toThrow('Could not start the workflow (500).');
  });

  it('triggerGithubWorkflowPoolRefresh includes the draw_id input', async () => {
    sessionStorage.setItem('badminton-app-gh-token', 'tok');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const { triggerGithubWorkflowPoolRefresh } = await freshApi();

    await triggerGithubWorkflowPoolRefresh('12');

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ ref: 'main', inputs: { draw_id: '12' } });
  });

  it('pollGithubWorkflowRun returns a queued placeholder when no run matches yet', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workflow_runs: [] }) });
    const { pollGithubWorkflowRun } = await freshApi();
    await expect(pollGithubWorkflowRun(new Date().toISOString())).resolves.toEqual({
      status: 'queued', conclusion: null, htmlUrl: null,
    });
  });

  it('pollGithubWorkflowRun returns the matching run status', async () => {
    const dispatchedAt = '2026-01-01T00:00:00.000Z';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_runs: [{ created_at: '2026-01-01T00:00:01.000Z', status: 'completed', conclusion: 'success', html_url: 'https://x' }],
      }),
    });
    const { pollGithubWorkflowRun } = await freshApi();
    await expect(pollGithubWorkflowRun(dispatchedAt)).resolves.toEqual({
      status: 'completed', conclusion: 'success', htmlUrl: 'https://x',
    });
  });

  it('pollGithubWorkflowRun throws when the status check fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { pollGithubWorkflowRun } = await freshApi();
    await expect(pollGithubWorkflowRun(new Date().toISOString())).rejects.toThrow('Could not check workflow status (500).');
  });
});

describe('simulateSingles / simulateDoubles / fetchTournaments / simulateMatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockPlayersBundle(extra = {}) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        players: [
          { id: 'p1', name: 'Alice', singlesRating: 1600, singlesPlayed: 20, doublesRating: 1550, doublesPlayed: 8 },
          { id: 'p2', name: 'Bob', singlesRating: 1500, singlesPlayed: 3, doublesRating: 1500, doublesPlayed: 0 },
          { id: 'p3', name: 'Carl', singlesRating: 1400, singlesPlayed: 1, doublesRating: 1500, doublesPlayed: 0 },
          { id: 'p4', name: 'Dana', singlesRating: 1300, singlesPlayed: 0, doublesRating: 1500, doublesPlayed: 0 },
        ],
        singlesH2H: { 'p1|p2': { p1: 3, p2: 1 } },
        doublesPairH2H: {},
        ...extra,
      }),
    });
  }

  it('simulateSingles returns ratings, probabilities and head-to-head record', async () => {
    mockPlayersBundle();
    const { simulateSingles } = await freshApi();
    const result = await simulateSingles('p1', 'p2');
    expect(result.playerA.rating).toBe(1600);
    expect(result.winProbabilityA).toBeGreaterThan(0.5);
    expect(result.headToHead).toEqual({ playerAWins: 3, playerBWins: 1 });
  });

  it('simulateSingles rejects unknown ids and identical ids', async () => {
    mockPlayersBundle();
    const { simulateSingles } = await freshApi();
    await expect(simulateSingles('p1', 'nope')).rejects.toThrow('unknown player id(s)');
    await expect(simulateSingles('p1', 'p1')).rejects.toThrow('players must be different');
  });

  it('simulateDoubles validates shape, distinctness and known ids, and returns averaged ratings', async () => {
    mockPlayersBundle();
    const { simulateDoubles } = await freshApi();
    await expect(simulateDoubles(['p1'], ['p2', 'p3'])).rejects.toThrow('teamA and teamB must each have exactly 2 player ids');
    await expect(simulateDoubles(['p1', 'p2'], ['p1', 'p2'])).rejects.toThrow('all four players must be different');
    await expect(simulateDoubles(['p1', 'nope'], ['p2', 'p3'])).rejects.toThrow('unknown player id(s)');

    const result = await simulateDoubles(['p1', 'p3'], ['p2', 'p4']);
    expect(result.teamARating).toBe(Math.round((1550 + 1500) / 2));
    expect(result.headToHead).toBeNull();
  });

  it('fetchTournaments returns the bundle tournaments, defaulting to an empty array', async () => {
    mockPlayersBundle();
    const { fetchTournaments } = await freshApi();
    await expect(fetchTournaments()).resolves.toEqual([]);
  });

  it('simulateMatch supports 1v1 rubbers with head-to-head lookup', async () => {
    mockPlayersBundle();
    const { simulateMatch } = await freshApi();
    const result = await simulateMatch('singles', 'p1', 'p2');
    expect(result.ratingA).toBe(1600);
    expect(result.headToHead).toEqual({ aWins: 3, bWins: 1 });
  });

  it('simulateMatch supports 2v2 rubbers and rejects duplicate/unknown ids', async () => {
    mockPlayersBundle();
    const { simulateMatch } = await freshApi();
    await expect(simulateMatch('doubles', ['p1', 'nope'], ['p2', 'p3'])).rejects.toThrow('unknown player id(s)');
    await expect(simulateMatch('doubles', ['p1', 'p2'], ['p1', 'p3'])).rejects.toThrow('all players in a rubber must be different');

    const result = await simulateMatch('doubles', ['p1', 'p3'], ['p2', 'p4']);
    expect(result.ratingA).toBe(Math.round((1550 + 1500) / 2));
    expect(result.headToHead).toBeNull();
  });
});
