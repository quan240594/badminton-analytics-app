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

describe('computeRatings - doubles/mixed', () => {
  function doublesMatch({ discipline, homeGuids, awayGuids, winnerSide }) {
    return {
      discipline,
      winnerSide,
      home: homeGuids.map((guid, i) => ({ id: `h${i}`, name: `H${i}`, guid })),
      away: awayGuids.map((guid, i) => ({ id: `a${i}`, name: `A${i}`, guid })),
    };
  }

  it('moves both winning-team ratings up together and records a pair head-to-head', () => {
    const matches = [
      doublesMatch({ discipline: 'doubles', homeGuids: ['g1', 'g2'], awayGuids: ['g3', 'g4'], winnerSide: 'home' }),
    ];

    const { doublesPlayer, doublesPairH2H } = computeRatings(matches);

    expect(doublesPlayer.get('g1').rating).toBeGreaterThan(1500);
    expect(doublesPlayer.get('g2').rating).toBe(doublesPlayer.get('g1').rating);
    expect(doublesPlayer.get('g3').rating).toBeLessThan(1500);
    expect(doublesPlayer.get('g1').won).toBe(1);
    expect(doublesPlayer.get('g3').won).toBe(0);

    const pairKeyA = ['g1', 'g2'].sort((a, b) => a.localeCompare(b)).join('+');
    const pairKeyB = ['g3', 'g4'].sort((a, b) => a.localeCompare(b)).join('+');
    const matchupKey = [pairKeyA, pairKeyB].sort((a, b) => a.localeCompare(b)).join('_vs_');
    expect(doublesPairH2H.get(matchupKey)).toEqual({ [pairKeyA]: 1 });
  });

  it('keeps mixed matches in their own book, separate from doubles', () => {
    const matches = [
      doublesMatch({ discipline: 'mixed', homeGuids: ['m1', 'm2'], awayGuids: ['m3', 'm4'], winnerSide: 'away' }),
    ];

    const { mixedPlayer, doublesPlayer } = computeRatings(matches);

    expect(mixedPlayer.get('m1').rating).toBeLessThan(1500);
    expect(mixedPlayer.get('m3').rating).toBeGreaterThan(1500);
    expect(doublesPlayer.size).toBe(0);
  });

  it('skips a doubles match with a duplicate guid across the four slots', () => {
    const matches = [
      doublesMatch({ discipline: 'doubles', homeGuids: ['g1', 'g1'], awayGuids: ['g3', 'g4'], winnerSide: 'home' }),
    ];

    const { doublesPlayer } = computeRatings(matches);

    expect(doublesPlayer.size).toBe(0);
  });
});
