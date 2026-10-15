import { describe, it, expect } from 'vitest';
import { formatRecord, recordSummary } from './profile.js';

describe('formatRecord', () => {
  it('shows wins, losses and the win percentage', () => {
    expect(formatRecord({ wins: 97, losses: 60 })).toBe('97–60 (62%)');
    expect(formatRecord({ wins: 1, losses: 2 })).toBe('1–2 (33%)');
  });

  it('has no percentage without any match, and a dash without a record', () => {
    expect(formatRecord({ wins: 0, losses: 0 })).toBe('0–0');
    expect(formatRecord(undefined)).toBe('-');
  });
});

describe('recordSummary', () => {
  it('joins the career and this-year records', () => {
    expect(recordSummary({ career: { wins: 3, losses: 1 }, thisYear: { wins: 2, losses: 2 } })).toBe(
      'Career 3–1 (75%) · This year 2–2 (50%)'
    );
  });

  it('shows what is there and is empty without statistics', () => {
    expect(recordSummary({ career: { wins: 1, losses: 1 } })).toBe('Career 1–1 (50%)');
    expect(recordSummary(undefined)).toBe('');
    expect(recordSummary({})).toBe('');
  });
});
