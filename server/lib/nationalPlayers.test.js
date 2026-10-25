import { describe, it, expect } from 'vitest';
import { buildNationalPlayers, disciplineOf } from './nationalPlayers.js';

const entry = (rank, points, matches = 10) => ({ rank, points, matches });
const ranked = (name, ranks) => ({ name, playerId: 'p', ranks });
const adult = (rankings, week = '40-2026') => ({ 75: { week, rankings } });

describe('disciplineOf', () => {
  it.each([
    ['Mannen Enkel', 'singles'],
    ['Vrouwen Enkel', 'singles'],
    ['Mannen Dubbel', 'doubles'],
    ['Vrouwen Dubbel', 'doubles'],
    ['Gemengd Dubbel', 'mixed'],
    ['Something Else', null],
  ])('%s -> %s', (label, discipline) => {
    expect(disciplineOf(label)).toBe(discipline);
  });
});

describe('buildNationalPlayers', () => {
  it('returns nothing without a state or players', () => {
    expect(buildNationalPlayers(undefined)).toEqual([]);
    expect(buildNationalPlayers({})).toEqual([]);
  });

  it('gives each player the ranking card shape, measured against the #1 of their own category', () => {
    const state = {
      players: {
        100: ranked('Top Man', adult({ 'Mannen Enkel': entry(1, 1000), 'Mannen Dubbel': entry(3, 400) })),
        200: ranked('Second Man', adult({ 'Mannen Enkel': entry(2, 800), 'Mannen Dubbel': entry(1, 500) })),
        300: ranked('Top Woman', adult({ 'Vrouwen Enkel': entry(1, 600) })),
        400: ranked('Other Woman', adult({ 'Vrouwen Enkel': entry(2, 300) })),
      },
    };

    const byId = Object.fromEntries(buildNationalPlayers(state).map((p) => [p.id, p]));

    expect(byId[100]).toEqual({
      id: '100',
      name: 'Top Man',
      memberId: '100',
      url: 'https://badmintonnederland.toernooi.nl/find/player?q=100',
      nationalRanking: {
        singles: { rank: 1, points: 1000, topPoints: 1000, topName: 'Top Man', pctOfTop: 1 },
        doubles: { rank: 3, points: 400, topPoints: 500, topName: 'Second Man', pctOfTop: 0.8 },
        mixed: null,
      },
    });
    // a woman is compared with the best woman, not the best man
    expect(byId[400].nationalRanking.singles).toEqual({ rank: 2, points: 300, topPoints: 600, topName: 'Top Woman', pctOfTop: 0.5 });
  });

  it('uses the adult list when a player is on both, and the junior list only for a junior-only player', () => {
    const state = {
      players: {
        1: ranked('Both', { 164: { week: 'w', rankings: { 'Mannen Enkel': entry(5, 90) } }, ...adult({ 'Mannen Enkel': entry(50, 700) }) }),
        2: ranked('Junior Only', { 164: { week: 'w', rankings: { 'Mannen Enkel': entry(1, 100) } } }),
      },
    };

    const byId = Object.fromEntries(buildNationalPlayers(state).map((p) => [p.id, p]));

    expect(byId[1].nationalRanking.singles).toMatchObject({ rank: 50, points: 700, topPoints: 700 });
    expect(byId[2].nationalRanking.singles).toMatchObject({ rank: 1, points: 100, topPoints: 100, topName: 'Junior Only' });
  });

  it('skips players without a usable ranking: no list, an unknown category, or a blank rank', () => {
    const state = {
      players: {
        1: ranked('No List', {}),
        2: ranked('Odd Category', adult({ Overig: entry(1, 10) })),
        3: ranked('Blank Rank', adult({ 'Mannen Enkel': entry(null, 10) })),
        4: ranked('Fine', adult({ 'Mannen Enkel': entry(1, 10) })),
      },
    };

    expect(buildNationalPlayers(state).map((p) => p.id)).toEqual(['4']);
  });

  it('ignores a blank rank when picking the #1', () => {
    const state = {
      players: {
        1: ranked('Tied', adult({ 'Mannen Enkel': entry(null, 999) })),
        2: ranked('Real Top', adult({ 'Mannen Enkel': entry(1, 500) })),
      },
    };

    const [player] = buildNationalPlayers(state);
    expect(player.nationalRanking.singles.topName).toBe('Real Top');
  });
});
