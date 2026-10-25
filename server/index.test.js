import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

process.env.PORT = '0';

const files = {};
const spawnCalls = [];

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn((path) => {
    const key = Object.keys(files).find((k) => String(path).endsWith(k));
    if (key === undefined) throw new Error(`ENOENT: ${path}`);
    return files[key];
  }),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd, args, opts) => {
    const handlers = { close: [], error: [], data: [] };
    const child = {
      stderr: { on: vi.fn((event, cb) => handlers.data.push(cb)) },
      on: vi.fn((event, cb) => {
        handlers[event]?.push(cb);
      }),
    };
    spawnCalls.push({ cmd, args, opts, handlers });
    return child;
  }),
}));

const CURRENT_TOURNAMENT_ID = '9A42A3C8-BE3A-4EB6-AEEB-8D7D562D964E';

vi.mock('./lib/dataset.js', () => ({
  loadDataset: vi.fn(() => ({
    players: new Map([
      ['g1', { name: 'Bob', club: 'C1' }],
      ['g2', { name: 'Alice', club: 'C2' }],
      ['g3', { name: 'Carl', club: 'C3' }],
      ['g4', { name: 'Dana', club: 'C4' }],
    ]),
    matches: [],
    rankings: new Map([['g1', { singles: { rank: 1, points: 500 } }]]),
    rankingTop: { singles: { name: 'Top', points: 1000 } },
    highestDivisionPlayed: vi.fn(() => ({ division: 'Eredivisie', year: 2025 })),
    titlesForPlayer: vi.fn(() => ({ singles: null, doubles: null, mixed: null })),
    titleCounts: vi.fn(() => ({ byYear: {}, total: { gold: 0, silver: 0, bronze: 0 } })),
    titleYears: [2024, 2025],
    aliasIndex: new Map([
      [`${CURRENT_TOURNAMENT_ID}:local1`, 'g1'],
      [`${CURRENT_TOURNAMENT_ID}:local2`, 'g2'],
    ]),
  })),
}));

vi.mock('./lib/elo.js', () => ({
  computeRatings: vi.fn(() => ({
    singles: new Map([
      ['g1', { rating: 1600, played: 20 }],
      ['g2', { rating: 1500, played: 0 }],
    ]),
    doublesPlayer: new Map([
      ['g1', { rating: 1550, played: 8 }],
      ['g2', { rating: 1500, played: 0 }],
      ['g3', { rating: 1500, played: 0 }],
      ['g4', { rating: 1500, played: 0 }],
    ]),
    mixedPlayer: new Map([['g1', { rating: 1500, played: 2 }]]),
    singlesH2H: new Map([['g1|g2', { g1: 3, g2: 1 }], ['g1|g3', { g1: 2 }]]),
    doublesPairH2H: new Map([['g1+g2_vs_g1+g2', { 'g1+g2': 2 }], ['g1+g3_vs_g2+g4', { 'g1+g3': 2 }]]),
  })),
  winProbability: vi.fn((ratingA, ratingB) => (ratingA >= ratingB ? 0.75 : 0.25)),
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

async function importApp() {
  vi.resetModules();
  spawnCalls.length = 0;
  const mod = await import('./index.js');
  return mod;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key];
});

describe('GET /api/players', () => {
  it('returns players sorted by name, filtered to those with matches or a current-season alias', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get('/api/players');
    server.close();

    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.id)).toEqual(['g2', 'g1']);
    const bob = res.body.find((p) => p.id === 'g1');
    expect(bob.singlesRating).toBe(1600);
    expect(bob.singlesWinRate).toBe(0.5);
  });
});

describe('GET /api/players/:id', () => {
  it('returns 404 for an unknown player id', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get('/api/players/nobody');
    server.close();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'player not found' });
  });

  it('returns the full summary for a known player id', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get('/api/players/g1');
    server.close();
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bob');
    expect(res.body.highestDivision).toEqual({ division: 'Eredivisie', year: 2025 });
  });
});

describe('GET /api/meta', () => {
  it('returns pool/league metadata', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get('/api/meta');
    server.close();
    expect(res.status).toBe(200);
    expect(res.body.playerCount).toBe(4);
    expect(res.body.poolLabel).toBe('Bondscompetitie 2026-2027 \u2013 Mannen Veer 2 afd. 12');
    expect(res.body.refreshing).toBe(false);
  });
});

const REFRESH_JOBS = [
  {
    name: 'POST /api/refresh',
    label: 'refresh',
    progressUrl: '/api/refresh/progress',
    progressFile: 'refresh_progress.json',
    args: ['refresh_data.py'],
    start: (app) => request(app).post('/api/refresh'),
  },
  {
    name: 'POST /api/refresh/pool',
    label: 'refresh/pool',
    progressUrl: '/api/refresh/pool/progress',
    progressFile: 'pool_fetch_progress.json',
    args: ['fetch_pool.py', '--draw-id', '12'],
    start: (app) => request(app).post('/api/refresh/pool').send({ drawId: '12' }),
  },
];

const emit = (spawnIndex, event, ...payload) => spawnCalls[spawnIndex].handlers[event].forEach((cb) => cb(...payload));

describe.each(REFRESH_JOBS)('$name', ({ label, progressUrl, progressFile, args, start }) => {
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves the progress file contents when present', async () => {
    files[progressFile] = JSON.stringify({ step: 'x', percent: 42, running: true, error: null });
    const { app, server } = await importApp();
    const res = await request(app).get(progressUrl);
    server.close();
    expect(res.body).toEqual({ step: 'x', percent: 42, running: true, error: null });
  });

  it('falls back to an idle status when the progress file is missing', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get(progressUrl);
    server.close();
    expect(res.body).toEqual({ step: 'idle', percent: 100, running: false, error: null });
  });

  it('spawns the scraper, reloads and rebuilds on success, then clears the refreshing flag', async () => {
    const { app, server } = await importApp();

    const started = await start(app);
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ started: true });
    expect(spawnCalls[0].args).toEqual(args);

    const midway = await request(app).get(progressUrl);
    expect(midway.body).toMatchObject({ step: 'starting', running: true });

    emit(0, 'close', 0);
    await flush();
    expect(spawnCalls[1].args).toEqual(['build-static.js']);
    emit(1, 'close', 0);
    await flush();
    await flush();

    const done = await request(app).get(progressUrl);
    server.close();
    expect(done.body.running).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`[${label}] reloaded 4 players and rebuilt data.json at`));
  });

  it('rejects a second refresh while one is already running', async () => {
    const { app, server } = await importApp();
    await start(app);
    const second = await start(app);
    server.close();
    expect(second.status).toBe(409);
  });

  it('clears the refreshing flag without rebuilding when the scraper exits non-zero, logging its stderr tail', async () => {
    const { app, server } = await importApp();
    await start(app);
    emit(0, 'data', Buffer.from('a'.repeat(2500)));
    emit(0, 'data', Buffer.from('END'));
    emit(0, 'close', 1);
    await flush();
    const progress = await request(app).get(progressUrl);
    server.close();

    expect(progress.body.running).toBe(false);
    expect(spawnCalls).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(`[${label}] failed with exit code 1`);
    const stderrPrefix = `[${label}] stderr: `;
    const [stderrLog] = errorSpy.mock.calls.map(([msg]) => msg).filter((msg) => msg.startsWith(stderrPrefix));
    expect(stderrLog.slice(stderrPrefix.length)).toHaveLength(2000);
    expect(stderrLog.endsWith('END')).toBe(true);
  });

  it('does not log a stderr line when the failed scraper wrote nothing', async () => {
    const { app, server } = await importApp();
    await start(app);
    emit(0, 'close', 1);
    await flush();
    server.close();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the refreshing flag when the child process fails to start', async () => {
    const { app, server } = await importApp();
    await start(app);
    emit(0, 'error', new Error('spawn failed'));
    await flush();
    const progress = await request(app).get(progressUrl);
    server.close();
    expect(progress.body.running).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(`[${label}] failed to start: spawn failed`);
  });

  it.each([
    ['its stderr', () => { emit(1, 'data', Buffer.from('syntax error')); emit(1, 'close', 1); }, 'syntax error'],
    ['the exit code when it wrote no stderr', () => emit(1, 'close', 3), 'build-static.js exited with code 3'],
    ['a spawn error', () => emit(1, 'error', new Error('no node')), 'no node'],
  ])('logs why the static bundle rebuild failed: %s', async (_case, failBuild, reason) => {
    const { app, server } = await importApp();
    await start(app);
    emit(0, 'close', 0);
    await flush();
    failBuild();
    await flush();
    await flush();
    const progress = await request(app).get(progressUrl);
    server.close();

    expect(errorSpy).toHaveBeenCalledWith(`[${label}] failed to rebuild static bundle: ${reason}`);
    expect(progress.body.running).toBe(false);
  });
});

describe('POST /api/refresh/pool validation', () => {
  it('requires a numeric drawId', async () => {
    const { app, server } = await importApp();
    const missing = await request(app).post('/api/refresh/pool').send({});
    const nonNumeric = await request(app).post('/api/refresh/pool').send({ drawId: 'abc' });
    server.close();
    expect(missing.status).toBe(400);
    expect(nonNumeric.status).toBe(400);
  });

  it('rejects a pool refresh while a full refresh is already in progress', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh');
    const res = await request(app).post('/api/refresh/pool').send({ drawId: '12' });
    server.close();
    expect(res.status).toBe(409);
  });
});

describe('POST /api/simulate/singles', () => {
  it('defaults rating, played count and confidence for players missing from the rating book', async () => {
    const { app, server } = await importApp();
    const res = await request(app).post('/api/simulate/singles').send({ playerAId: 'g3', playerBId: 'g4' });
    server.close();
    expect(res.body.playerA).toMatchObject({ rating: 1500, played: 0, confidence: 'low' });
    expect(res.body.headToHead).toBeNull();
  });

  it('reports zero wins for whichever side is missing from a head-to-head record', async () => {
    const { app, server } = await importApp();
    const forward = await request(app).post('/api/simulate/singles').send({ playerAId: 'g1', playerBId: 'g3' });
    const reverse = await request(app).post('/api/simulate/singles').send({ playerAId: 'g3', playerBId: 'g1' });
    server.close();
    expect(forward.body.headToHead).toEqual({ playerAWins: 2, playerBWins: 0 });
    expect(reverse.body.headToHead).toEqual({ playerAWins: 0, playerBWins: 2 });
  });

  it('rejects unknown player ids and identical players', async () => {
    const { app, server } = await importApp();
    const unknown = await request(app).post('/api/simulate/singles').send({ playerAId: 'g1', playerBId: 'nope' });
    const same = await request(app).post('/api/simulate/singles').send({ playerAId: 'g1', playerBId: 'g1' });
    server.close();
    expect(unknown.status).toBe(400);
    expect(same.status).toBe(400);
  });

  it('returns win probabilities and head-to-head record for two known players', async () => {
    const { app, server } = await importApp();
    const res = await request(app).post('/api/simulate/singles').send({ playerAId: 'g1', playerBId: 'g2' });
    server.close();
    expect(res.status).toBe(200);
    expect(res.body.playerA.rating).toBe(1600);
    expect(res.body.winProbabilityA).toBe(0.75);
    expect(res.body.winProbabilityB).toBe(0.25);
    expect(res.body.headToHead).toEqual({ playerAWins: 3, playerBWins: 1 });
  });
});

describe('POST /api/simulate/doubles', () => {
  it('validates team shape, distinct players and known ids', async () => {
    const { app, server } = await importApp();
    const badShape = await request(app).post('/api/simulate/doubles').send({ teamA: ['g1'], teamB: ['g2', 'g1'] });
    const duplicate = await request(app)
      .post('/api/simulate/doubles')
      .send({ teamA: ['g1', 'g2'], teamB: ['g1', 'g2'] });
    const unknown = await request(app)
      .post('/api/simulate/doubles')
      .send({ teamA: ['g1', 'nope'], teamB: ['g2', 'also-nope'] });
    server.close();
    expect(badShape.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it('reports zero wins for whichever pair is missing from a head-to-head record', async () => {
    const { app, server } = await importApp();
    const forward = await request(app)
      .post('/api/simulate/doubles')
      .send({ teamA: ['g1', 'g3'], teamB: ['g2', 'g4'] });
    const reverse = await request(app)
      .post('/api/simulate/doubles')
      .send({ teamA: ['g2', 'g4'], teamB: ['g1', 'g3'] });
    server.close();
    expect(forward.body.headToHead).toEqual({ teamAWins: 2, teamBWins: 0 });
    expect(reverse.body.headToHead).toEqual({ teamAWins: 0, teamBWins: 2 });
  });

  it('returns a null head-to-head for pairs that never met', async () => {
    const { app, server } = await importApp();
    const res = await request(app)
      .post('/api/simulate/doubles')
      .send({ teamA: ['g1', 'g2'], teamB: ['g3', 'g4'] });
    server.close();
    expect(res.body.headToHead).toBeNull();
  });

  it('returns averaged team ratings and win probabilities for four distinct known players', async () => {
    const { app, server } = await importApp();
    const res = await request(app)
      .post('/api/simulate/doubles')
      .send({ teamA: ['g1', 'g3'], teamB: ['g2', 'g4'] });
    server.close();
    expect(res.status).toBe(200);
    expect(res.body.teamARating).toBe(Math.round((1550 + 1500) / 2));
    expect(res.body.teamBRating).toBe(Math.round((1500 + 1500) / 2));
    expect(res.body.winProbabilityA + res.body.winProbabilityB).toBe(1);
  });
});
