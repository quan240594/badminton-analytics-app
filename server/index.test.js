import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
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
    const handlers = { close: [], error: [] };
    const child = {
      stderr: { on: vi.fn() },
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
    singlesH2H: new Map([['g1|g2', { g1: 3, g2: 1 }]]),
    doublesPairH2H: new Map([['g1+g2_vs_g1+g2', { 'g1+g2': 2 }]]),
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

describe('GET /api/refresh/progress', () => {
  it('returns the progress file contents when present', async () => {
    files['refresh_progress.json'] = JSON.stringify({ step: 'events', percent: 42, running: true, error: null });
    const { app, server } = await importApp();
    const res = await request(app).get('/api/refresh/progress');
    server.close();
    expect(res.body).toEqual({ step: 'events', percent: 42, running: true, error: null });
  });

  it('falls back to an idle status when the progress file is missing', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get('/api/refresh/progress');
    server.close();
    expect(res.body).toEqual({ step: 'idle', percent: 100, running: false, error: null });
  });
});

describe('GET /api/refresh/pool/progress', () => {
  it('returns the pool progress file contents when present', async () => {
    files['pool_fetch_progress.json'] = JSON.stringify({ step: 'pool', percent: 10, running: true, error: null });
    const { app, server } = await importApp();
    const res = await request(app).get('/api/refresh/pool/progress');
    server.close();
    expect(res.body).toEqual({ step: 'pool', percent: 10, running: true, error: null });
  });

  it('falls back to an idle status when the pool progress file is missing', async () => {
    const { app, server } = await importApp();
    const res = await request(app).get('/api/refresh/pool/progress');
    server.close();
    expect(res.body).toEqual({ step: 'idle', percent: 100, running: false, error: null });
  });
});

describe('POST /api/refresh', () => {
  it('spawns refresh_data.py, reloads and rebuilds on success, then clears the refreshing flag', async () => {
    const { app, server } = await importApp();

    const started = await request(app).post('/api/refresh');
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ started: true });
    expect(spawnCalls[0].args).toEqual(['refresh_data.py']);

    const midway = await request(app).get('/api/refresh/progress');
    expect(midway.body.running).toBe(true);

    spawnCalls[0].handlers.close.forEach((cb) => cb(0));
    await flush();
    expect(spawnCalls[1].args).toEqual(['build-static.js']);
    spawnCalls[1].handlers.close.forEach((cb) => cb(0));
    await flush();
    await flush();

    const done = await request(app).get('/api/refresh/progress');
    server.close();
    expect(done.body.running).toBe(false);
  });

  it('rejects a second refresh while one is already running', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh');
    const second = await request(app).post('/api/refresh');
    server.close();
    expect(second.status).toBe(409);
  });

  it('clears the refreshing flag without rebuilding when the scraper exits non-zero', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh');
    spawnCalls[0].handlers.close.forEach((cb) => cb(1));
    await flush();
    const progress = await request(app).get('/api/refresh/progress');
    server.close();
    expect(progress.body.running).toBe(false);
    expect(spawnCalls).toHaveLength(1);
  });

  it('clears the refreshing flag when the child process fails to start', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh');
    spawnCalls[0].handlers.error.forEach((cb) => cb(new Error('spawn failed')));
    await flush();
    const progress = await request(app).get('/api/refresh/progress');
    server.close();
    expect(progress.body.running).toBe(false);
  });
});

describe('POST /api/refresh/pool', () => {
  it('requires a numeric drawId', async () => {
    const { app, server } = await importApp();
    const missing = await request(app).post('/api/refresh/pool').send({});
    const nonNumeric = await request(app).post('/api/refresh/pool').send({ drawId: 'abc' });
    server.close();
    expect(missing.status).toBe(400);
    expect(nonNumeric.status).toBe(400);
  });

  it('spawns fetch_pool.py with a reconstructed numeric drawId and succeeds', async () => {
    const { app, server } = await importApp();
    const started = await request(app).post('/api/refresh/pool').send({ drawId: '12' });
    expect(started.status).toBe(202);
    expect(spawnCalls[0].args).toEqual(['fetch_pool.py', '--draw-id', '12']);

    spawnCalls[0].handlers.close.forEach((cb) => cb(0));
    await flush();
    expect(spawnCalls[1].args).toEqual(['build-static.js']);
    spawnCalls[1].handlers.close.forEach((cb) => cb(0));
    await flush();
    await flush();

    const done = await request(app).get('/api/refresh/pool/progress');
    server.close();
    expect(done.body.running).toBe(false);
  });

  it('rejects a pool refresh while a refresh is already in progress', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh');
    const res = await request(app).post('/api/refresh/pool').send({ drawId: '12' });
    server.close();
    expect(res.status).toBe(409);
  });

  it('clears refreshing when the pool scraper exits non-zero', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh/pool').send({ drawId: '12' });
    spawnCalls[0].handlers.close.forEach((cb) => cb(1));
    await flush();
    const progress = await request(app).get('/api/refresh/pool/progress');
    server.close();
    expect(progress.body.running).toBe(false);
  });

  it('clears refreshing when the pool scraper fails to start', async () => {
    const { app, server } = await importApp();
    await request(app).post('/api/refresh/pool').send({ drawId: '12' });
    spawnCalls[0].handlers.error.forEach((cb) => cb(new Error('nope')));
    await flush();
    const progress = await request(app).get('/api/refresh/pool/progress');
    server.close();
    expect(progress.body.running).toBe(false);
  });
});

describe('POST /api/simulate/singles', () => {
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
