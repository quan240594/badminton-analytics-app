import { describe, it, expect } from 'vitest';
import {
  computeSlotAssignment,
  strongestSinglesFor,
  bestPairing,
  buildDefaultLineup,
  isWrongGenderForCode,
  disciplineForCode,
  requiredGenderForCode,
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
