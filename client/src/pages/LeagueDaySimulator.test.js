import { describe, it, expect } from 'vitest';
import {
  computeSlotAssignment,
  strongestSinglesFor,
  bestPairing,
  buildDefaultLineup,
  isWrongGenderForCode,
  disciplineForCode,
  requiredGenderForCode,
  compareStrength,
  isValidMixedPair,
} from './LeagueDaySimulator.jsx';

function player(id, club, rating, extra = {}) {
  return {
    id,
    club,
    singlesRating: rating,
    doublesRating: rating,
    mixedRating: rating,
    ...extra,
  };
}

function makeCtx(overrides = {}) {
  return {
    objective: 'excitement',
    poolA: [],
    poolB: [],
    byId: new Map(),
    playerGenders: {},
    protectTopSingles: false,
    firstSinglesIndex: -1,
    topSinglesA: null,
    topSinglesB: null,
    strongestSinglesA: null,
    strongestSinglesB: null,
    fixedA: null,
    fixedB: null,
    usage: new Map(),
    singlesUsage: new Map(),
    ...overrides,
  };
}

describe('computeSlotAssignment - singles', () => {
  it('picks the closest-rated pairing for "excitement"', () => {
    const a1 = player('a1', 'ClubA', 1600);
    const a2 = player('a2', 'ClubA', 1400);
    const b1 = player('b1', 'ClubB', 1610); // closest to a1
    const b2 = player('b2', 'ClubB', 1000);
    const byId = new Map([a1, a2, b1, b2].map((p) => [p.id, p]));
    const ctx = makeCtx({
      poolA: [a1, a2], poolB: [b1, b2], byId, objective: 'excitement',
    });
    const slot = { code: 'MS1', sideA: [''], sideB: [''] };
    const result = computeSlotAssignment(slot, 0, ctx);
    expect(result.sideA).toEqual(['a1']);
    expect(result.sideB).toEqual(['b1']);
  });

  it('leaves an already fully-entered rubber untouched for "excitement"', () => {
    const ctx = makeCtx({ objective: 'excitement' });
    const slot = { code: 'MS1', sideA: ['x'], sideB: ['y'] };
    const result = computeSlotAssignment(slot, 0, ctx);
    expect(result).toBe(slot);
  });

  it('locks the manual side and only optimizes the free side', () => {
    const free1 = player('free1', 'ClubA', 1600);
    const free2 = player('free2', 'ClubA', 1400);
    const locked = player('locked', 'ClubB', 1500);
    const byId = new Map([free1, free2, locked].map((p) => [p.id, p]));
    const ctx = makeCtx({
      poolA: [free1, free2], poolB: [locked], byId, objective: 'clubA',
    });
    // sideB fully entered -> locked for objective 'clubA' (never locks own club's side)
    const slot = { code: 'MS1', sideA: [''], sideB: ['locked'] };
    const result = computeSlotAssignment(slot, 0, ctx);
    expect(result.sideB).toEqual(['locked']);
    expect(result.sideA[0]).not.toBe('');
  });
});

describe('computeSlotAssignment - doubles/mixed', () => {
  it('produces a valid doubles pairing (2 players per side, no overlap)', () => {
    const a1 = player('a1', 'ClubA', 1600);
    const a2 = player('a2', 'ClubA', 1550);
    const a3 = player('a3', 'ClubA', 1400);
    const a4 = player('a4', 'ClubA', 1300);
    const b1 = player('b1', 'ClubB', 1580);
    const b2 = player('b2', 'ClubB', 1520);
    const byId = new Map([a1, a2, a3, a4, b1, b2].map((p) => [p.id, p]));
    const ctx = makeCtx({
      poolA: [a1, a2, a3, a4], poolB: [b1, b2], byId, objective: 'excitement',
    });
    const slot = { code: 'MD1', sideA: ['', ''], sideB: ['', ''] };
    const result = computeSlotAssignment(slot, 0, ctx);
    expect(result.sideA).toHaveLength(2);
    expect(result.sideB).toEqual(['b1', 'b2']);
    expect(new Set([...result.sideA, ...result.sideB]).size).toBe(4);
  });

  it('only pairs a valid man/woman combination for a mixed (XD) rubber', () => {
    const m1 = player('m1', 'ClubA', 1500, {});
    const w1 = player('w1', 'ClubA', 1500, {});
    const m2 = player('m2', 'ClubA', 1500, {});
    const oppM = player('om', 'ClubB', 1500, {});
    const oppW = player('ow', 'ClubB', 1500, {});
    const playerGenders = { m1: 'M', w1: 'F', m2: 'M', om: 'M', ow: 'F' };
    const byId = new Map([m1, w1, m2, oppM, oppW].map((p) => [p.id, p]));
    const ctx = makeCtx({
      poolA: [m1, w1, m2], poolB: [oppM, oppW], byId, playerGenders, objective: 'excitement',
    });
    const slot = { code: 'XD1', sideA: ['', ''], sideB: ['', ''] };
    const result = computeSlotAssignment(slot, 0, ctx);
    expect(result.sideA.sort()).toEqual(['m1', 'w1']);
    expect(result.sideB.sort()).toEqual(['om', 'ow']);
  });
});

describe('computeSlotAssignment - fixed small roster', () => {
  it('uses the pre-built fixed lineup for a side with a fixedA/fixedB entry', () => {
    const a1 = player('a1', 'ClubA', 1500);
    const b1 = player('b1', 'ClubB', 1500);
    const b2 = player('b2', 'ClubB', 1400);
    const byId = new Map([a1, b1, b2].map((p) => [p.id, p]));
    const ctx = makeCtx({
      poolA: [a1], poolB: [b1, b2], byId, objective: 'excitement',
      fixedA: { MS1: ['a1'] },
    });
    const slot = { code: 'MS1', sideA: [''], sideB: [''] };
    const result = computeSlotAssignment(slot, 0, ctx);
    expect(result.sideA).toEqual(['a1']);
  });
});

describe('computeSlotAssignment - appearance cap fallback', () => {
  it('relaxes the cap when every capped-eligible player is already at the limit', () => {
    const a1 = player('a1', 'ClubA', 1500);
    const b1 = player('b1', 'ClubB', 1500);
    const byId = new Map([a1, b1].map((p) => [p.id, p]));
    const usage = new Map([['a1', 3], ['b1', 0]]); // a1 already at MAX_RECOMMENDED_APPEARANCES
    const ctx = makeCtx({ poolA: [a1], poolB: [b1], byId, objective: 'excitement', usage });
    const slot = { code: 'MS2', sideA: [''], sideB: [''] };
    const result = computeSlotAssignment(slot, 1, ctx);
    // only one candidate per side either way - must still fill it via the relaxed attempt
    expect(result.sideA).toEqual(['a1']);
    expect(result.sideB).toEqual(['b1']);
  });
});

describe('strongestSinglesFor', () => {
  it('picks the highest-rated man (unranked players use rating only)', () => {
    const weak = player('weak', 'ClubA', 1400, {});
    const strong = player('strong', 'ClubA', 1700, {});
    const woman = player('woman', 'ClubA', 1900, {});
    const playerGenders = { weak: 'M', strong: 'M', woman: 'F' };
    const result = strongestSinglesFor([weak, strong, woman], playerGenders);
    expect(result.id).toBe('strong');
  });

  it('returns null for an empty/all-women pool', () => {
    const woman = player('woman', 'ClubA', 1900);
    const result = strongestSinglesFor([woman], { woman: 'F' });
    expect(result).toBeNull();
  });
});

describe('helper functions (unchanged behavior)', () => {
  it('disciplineForCode classifies codes correctly', () => {
    expect(disciplineForCode('MS1')).toBe('singles');
    expect(disciplineForCode('MD1')).toBe('doubles');
    expect(disciplineForCode('XD1')).toBe('mixed');
  });

  it('requiredGenderForCode maps codes to the expected gender', () => {
    expect(requiredGenderForCode('MS1')).toBe('M');
    expect(requiredGenderForCode('WD1')).toBe('F');
    expect(requiredGenderForCode('XD1')).toBeNull();
  });

  it('isWrongGenderForCode only flags a definite mismatch', () => {
    expect(isWrongGenderForCode('MS1', { id: 'p1' }, { p1: 'F' })).toBe(true);
    expect(isWrongGenderForCode('MS1', { id: 'p1' }, { p1: 'M' })).toBe(false);
    expect(isWrongGenderForCode('MS1', { id: 'p1' }, {})).toBe(false);
  });

  it('bestPairing returns null when no valid pairing exists', () => {
    const only = player('only', 'ClubA', 1500);
    const result = bestPairing('doubles', [only], [only], 'excitement', {});
    expect(result).toBeNull();
  });
});

describe('buildDefaultLineup', () => {
  it('rotates a 2-person roster evenly across singles + doubles slots', () => {
    const p1 = player('p1', 'ClubA', 1500);
    const p2 = player('p2', 'ClubA', 1500);
    const slots = [
      { code: 'MS1', sideA: [''], sideB: [''] },
      { code: 'MD1', sideA: ['', ''], sideB: ['', ''] },
    ];
    const assignment = buildDefaultLineup([p1, p2], slots, () => false, () => null);
    expect(assignment.MS1).toHaveLength(1);
    expect(assignment.MD1).toEqual(expect.arrayContaining(['p1', 'p2']));
  });
});

describe('compareStrength', () => {
  const ranked = (rank) => player(`r${rank}`, 'ClubA', 1500, { nationalRanking: { singles: { rank } } });

  it.each([
    ['both ranked: the lower rank is stronger', ranked(2), ranked(5), -3],
    ['only the first is ranked', ranked(9), player('u', 'ClubA', 2000), -1],
    ['only the second is ranked', player('u', 'ClubA', 2000), ranked(9), 1],
    ['neither ranked: the higher rating is stronger', player('u1', 'ClubA', 1400), player('u2', 'ClubA', 1600), 200],
    ['a missing rating counts as 1500', { id: 'x' }, player('u', 'ClubA', 1600), 100],
  ])('%s', (_case, a, b, expected) => {
    expect(compareStrength('singles', a, b)).toBe(expected);
  });
});

describe('isValidMixedPair', () => {
  const genders = { m1: 'M', m2: 'M', f1: 'F' };

  it.each([
    ['a man and a woman', 'm1', 'f1', true],
    ['two men', 'm1', 'm2', false],
    ['a player with unknown gender next to a man', 'x', 'm1', true],
    ['two players with unknown gender', 'x', 'y', true],
  ])('accepts %s: %s', (_case, id1, id2, expected) => {
    expect(isValidMixedPair({ id: id1 }, { id: id2 }, genders)).toBe(expected);
  });
});

describe('computeSlotAssignment - objectives and locks', () => {
  const a1 = player('a1', 'ClubA', 1700);
  const a2 = player('a2', 'ClubA', 1400);
  const b1 = player('b1', 'ClubB', 1600);
  const b2 = player('b2', 'ClubB', 1000);
  const byId = new Map([a1, a2, b1, b2].map((p) => [p.id, p]));
  const open = { code: 'MS1', sideA: [''], sideB: [''] };

  it.each([
    ['clubA', ['a1'], ['b2']],
    ['clubB', ['a2'], ['b1']],
  ])('"%s" picks the pairing that is best for that club', (objective, sideA, sideB) => {
    const result = computeSlotAssignment(open, 0, makeCtx({ objective, poolA: [a1, a2], poolB: [b1, b2], byId }));

    expect([result.sideA, result.sideB]).toEqual([sideA, sideB]);
  });

  it.each([
    ['clubB', { code: 'MS1', sideA: ['a1'], sideB: [''] }, 'sideA'],
    ['excitement', { code: 'MS1', sideA: ['a1'], sideB: [''] }, 'sideA'],
    ['excitement', { code: 'MS1', sideA: [''], sideB: ['b1'] }, 'sideB'],
  ])('keeps the already-entered %s side locked for "%s"', (objective, slot, lockedSide) => {
    const freeSide = lockedSide === 'sideA' ? 'sideB' : 'sideA';
    const result = computeSlotAssignment(slot, 0, makeCtx({ objective, poolA: [a1, a2], poolB: [b1, b2], byId }));

    expect(result[lockedSide]).toEqual(slot[lockedSide]);
    expect(result[freeSide][0]).not.toBe('');
  });

  it('does not count a locked side towards the appearance caps', () => {
    const ctx = makeCtx({ objective: 'clubA', poolA: [a1, a2], poolB: [b1], byId });

    computeSlotAssignment({ code: 'MS1', sideA: [''], sideB: ['b1'] }, 0, ctx);

    expect(ctx.usage.get('b1')).toBeUndefined();
    expect(ctx.singlesUsage.get('b1')).toBeUndefined();
    expect(ctx.usage.get('a1')).toBe(1);
    expect(ctx.singlesUsage.get('a1')).toBe(1);
  });

  it('does not pair a player with themselves when both clubs list them', () => {
    const shared = player('shared', 'ClubA', 1500);
    const result = computeSlotAssignment(open, 0, makeCtx({ poolA: [shared, a2], poolB: [shared, b2], byId }));

    expect(result.sideA[0]).not.toBe(result.sideB[0]);
  });

  it('leaves the rubber untouched when no valid doubles pairing exists', () => {
    const shared = player('shared', 'ClubA', 1500);
    const slot = { code: 'MD1', sideA: ['', ''], sideB: ['', ''] };

    expect(computeSlotAssignment(slot, 0, makeCtx({ poolA: [shared, a2], poolB: [shared, b2], byId }))).toBe(slot);
  });

  it('falls back to a player who already played singles when nobody else is left', () => {
    const ctx = makeCtx({ poolA: [a1], poolB: [b1], byId, singlesUsage: new Map([['a1', 1]]) });

    const result = computeSlotAssignment({ code: 'MS2', sideA: [''], sideB: [''] }, 3, ctx);

    expect(result.sideA).toEqual(['a1']);
  });

  it('keeps the protected top singles player out of earlier rubbers and seeds him into the first singles', () => {
    const top = player('top', 'ClubA', 1900);
    const mid = player('mid', 'ClubA', 1500);
    const low = player('low', 'ClubA', 1400);
    const poolB = [b1, b2, player('b3', 'ClubB', 1300)];
    const ctx = makeCtx({
      objective: 'excitement', poolA: [top, mid, low], poolB, byId, protectTopSingles: true, firstSinglesIndex: 2,
      topSinglesA: top, topSinglesB: b1, strongestSinglesA: top, strongestSinglesB: b1,
    });

    const doubles = computeSlotAssignment({ code: 'MD1', sideA: ['', ''], sideB: ['', ''] }, 0, ctx);
    const firstSingles = computeSlotAssignment({ code: 'MS1', sideA: [''], sideB: [''] }, 2, ctx);

    expect(doubles.sideA).not.toContain('top');
    expect(doubles.sideB).not.toContain('b1');
    expect([firstSingles.sideA, firstSingles.sideB]).toEqual([['top'], ['b1']]);
  });

  it('defaults a missing rating to 1500 when pairing', () => {
    const unrated = { id: 'unrated', club: 'ClubA' };
    const result = computeSlotAssignment(open, 0, makeCtx({ poolA: [unrated], poolB: [player('even', 'ClubB', 1500)], byId }));

    expect([result.sideA, result.sideB]).toEqual([['unrated'], ['even']]);
  });
});

describe('buildDefaultLineup without a pinned player', () => {
  it('rotates players by usage when there is no pin function', () => {
    const pool = [player('p1', 'ClubA', 1500), player('p2', 'ClubA', 1500), player('p3', 'ClubA', 1500)];
    const slots = [
      { code: 'MS1', sideA: [''], sideB: [''] },
      { code: 'MS2', sideA: [''], sideB: [''] },
      { code: 'MS3', sideA: [''], sideB: [''] },
    ];

    const lineup = buildDefaultLineup(pool, slots, () => false);

    expect(Object.values(lineup).flat().sort()).toEqual(['p1', 'p2', 'p3']);
  });
});
