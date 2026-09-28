import { describe, it, expect } from 'vitest';
import { computeRatings } from './elo.js';

function singlesMatch({ homeGuid, awayGuid, winnerSide }) {
  return {
    discipline: 'singles',
    winnerSide,
    home: [{ id: 'h1', name: 'Home', guid: homeGuid }],
    away: [{ id: 'a1', name: 'Away', guid: awayGuid }],
  };
}

describe('computeRatings', () => {
  it('raises the winner rating and lowers the loser rating from the 1500 default', () => {
    const matches = [singlesMatch({ homeGuid: 'guid-a', awayGuid: 'guid-b', winnerSide: 'home' })];

    const { singles } = computeRatings(matches);

    expect(singles.get('guid-a').rating).toBeGreaterThan(1500);
    expect(singles.get('guid-b').rating).toBeLessThan(1500);
    expect(singles.get('guid-a').played).toBe(1);
    expect(singles.get('guid-a').won).toBe(1);
    expect(singles.get('guid-b').won).toBe(0);
  });

  it('ignores a match where a side never resolved to a real guid', () => {
    const matches = [singlesMatch({ homeGuid: null, awayGuid: 'guid-b', winnerSide: 'home' })];

    const { singles } = computeRatings(matches);

    expect(singles.size).toBe(0);
  });

  it('records a head-to-head win for the winning side', () => {
    const matches = [singlesMatch({ homeGuid: 'guid-a', awayGuid: 'guid-b', winnerSide: 'home' })];

    const { singlesH2H } = computeRatings(matches);

    const key = ['guid-a', 'guid-b'].sort((a, b) => a.localeCompare(b)).join('|');
    expect(singlesH2H.get(key)).toEqual({ 'guid-a': 1 });
  });
});
