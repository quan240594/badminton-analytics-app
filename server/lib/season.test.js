import { describe, it, expect } from 'vitest';
import { currentSeasonLabel } from './season.js';

describe('currentSeasonLabel', () => {
  it('spans into next year for months September-December', () => {
    expect(currentSeasonLabel(new Date(2026, 8, 1))).toBe('2026-2027');
    expect(currentSeasonLabel(new Date(2026, 11, 31))).toBe('2026-2027');
  });

  it('spans back from the prior year for months January-August', () => {
    expect(currentSeasonLabel(new Date(2027, 0, 1))).toBe('2026-2027');
    expect(currentSeasonLabel(new Date(2027, 7, 31))).toBe('2026-2027');
  });

  it('defaults to today when no date is given', () => {
    expect(typeof currentSeasonLabel()).toBe('string');
  });
});
