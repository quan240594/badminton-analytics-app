import { describe, it, expect } from 'vitest';
import { computeCareerStats } from './stats.js';

function makeMatch({ discipline, home, away, winnerSide, score }) {
  return { discipline, home, away, winnerSide, score };
}

describe('computeCareerStats', () => {
  it('tallies played/won/sets/points for both sides of a singles match', () => {
    const matches = [
      makeMatch({
        discipline: 'singles',
        home: [{ id: 'h1', name: 'Home', guid: 'guid-a' }],
        away: [{ id: 'a1', name: 'Away', guid: 'guid-b' }],
        winnerSide: 'home',
        score: '21-14 18-21 21-19',
      }),
    ];

    const stats = computeCareerStats(matches);

    const a = stats.get('guid-a').singles;
    expect(a).toEqual({ played: 1, won: 1, setsPlayed: 3, setsWon: 2, pointsPlayed: 21 + 14 + 18 + 21 + 21 + 19, pointsWon: 21 + 18 + 21 });

    const b = stats.get('guid-b').singles;
    expect(b).toEqual({ played: 1, won: 0, setsPlayed: 3, setsWon: 1, pointsPlayed: 21 + 14 + 18 + 21 + 21 + 19, pointsWon: 14 + 21 + 19 });
  });

  it('tallies stats for all four players of a doubles match', () => {
    const matches = [
      makeMatch({
        discipline: 'doubles',
        home: [
          { id: 'h1', name: 'H1', guid: 'guid-a' },
          { id: 'h2', name: 'H2', guid: 'guid-b' },
        ],
        away: [
          { id: 'a1', name: 'A1', guid: 'guid-c' },
          { id: 'a2', name: 'A2', guid: 'guid-d' },
        ],
        winnerSide: 'away',
        score: '18-21 15-21',
      }),
    ];

    const stats = computeCareerStats(matches);

    for (const guid of ['guid-a', 'guid-b']) {
      expect(stats.get(guid).doubles).toEqual({ played: 1, won: 0, setsPlayed: 2, setsWon: 0, pointsPlayed: 18 + 21 + 15 + 21, pointsWon: 18 + 15 });
    }
    for (const guid of ['guid-c', 'guid-d']) {
      expect(stats.get(guid).mixed.played).toBe(0); // stays in its own discipline bucket
      expect(stats.get(guid).doubles).toEqual({ played: 1, won: 1, setsPlayed: 2, setsWon: 2, pointsPlayed: 18 + 21 + 15 + 21, pointsWon: 21 + 21 });
    }
  });

  it('ignores players without a resolvable guid and skips unrecognized disciplines', () => {
    const matches = [
      makeMatch({
        discipline: 'singles',
        home: [{ id: 'h1', name: 'Home', guid: null }],
        away: [{ id: 'a1', name: 'Away', guid: 'guid-b' }],
        winnerSide: 'home',
        score: '21-10',
      }),
      makeMatch({
        discipline: 'unknown',
        home: [{ id: 'h1', name: 'Home', guid: 'guid-a' }],
        away: [{ id: 'a1', name: 'Away', guid: 'guid-b' }],
        winnerSide: 'home',
        score: '21-10',
      }),
    ];

    const stats = computeCareerStats(matches);

    expect(stats.has('guid-a')).toBe(false);
    expect(stats.get('guid-b').singles).toEqual({ played: 1, won: 0, setsPlayed: 1, setsWon: 0, pointsPlayed: 31, pointsWon: 10 });
  });
});

describe('computeCareerStats - missing score', () => {
  it('counts the match but no sets or points when the score is absent', () => {
    const stats = computeCareerStats([
      makeMatch({
        discipline: 'singles',
        home: [{ id: 'h1', name: 'Home', guid: 'guid-a' }],
        away: [{ id: 'a1', name: 'Away', guid: 'guid-b' }],
        winnerSide: 'home',
        score: undefined,
      }),
    ]);

    expect(stats.get('guid-a').singles).toEqual({ played: 1, won: 1, setsPlayed: 0, setsWon: 0, pointsPlayed: 0, pointsWon: 0 });
  });
});
