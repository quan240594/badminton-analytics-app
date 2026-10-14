import { describe, it, expect } from 'vitest';
import { formatDateRange, tournamentUrl, upcomingTournaments } from './upcoming.js';

const TOURNAMENTS = [
  { id: 'PAST', name: 'Past Open', dates: ['2026-09-05 00:00'], location: 'Utrecht' },
  { id: 'TODAY', name: 'Today Open', dates: ['2026-10-14 00:00'] },
  { id: 'RUNNING', name: 'Running Cup', dates: ['2026-10-01 00:00', '2026-10-20 23:59'] },
  { id: 'LATER', name: 'Later Masters', dates: ['2026-12-05 00:00', '2026-12-06 23:59'], location: 'Breda' },
  { id: 'SOON', name: 'Soon Open', dates: ['2026-11-07 00:00'] },
  { id: 'UNDATED', name: 'Undated', dates: [] },
];
const NOW = new Date(2026, 9, 14, 15, 30);

describe('upcomingTournaments', () => {
  it('keeps tournaments that have not ended, soonest start first, with the events entered', () => {
    const entries = [
      { id: 'LATER', events: ['HE 7'] },
      { id: 'SOON', events: [] },
      { id: 'RUNNING', events: ['HD 7', 'GD 7'] },
    ];
    const result = upcomingTournaments(entries, TOURNAMENTS, NOW);
    expect(result.map((t) => t.id)).toEqual(['RUNNING', 'SOON', 'LATER']);
    expect(result[0].events).toEqual(['HD 7', 'GD 7']);
    expect(result[2]).toMatchObject({ name: 'Later Masters', location: 'Breda' });
  });

  it('counts a tournament that is on today, and drops finished, undated and unknown ones', () => {
    const entries = ['PAST', 'TODAY', 'UNDATED', 'GONE'].map((id) => ({ id, events: [] }));
    expect(upcomingTournaments(entries, TOURNAMENTS, NOW).map((t) => t.id)).toEqual(['TODAY']);
  });

  it('is empty without entries', () => {
    expect(upcomingTournaments(undefined, TOURNAMENTS, NOW)).toEqual([]);
    expect(upcomingTournaments([], TOURNAMENTS, NOW)).toEqual([]);
  });
});

describe('formatDateRange', () => {
  it('shows a single day once and a range with both ends', () => {
    expect(formatDateRange(new Date(2026, 10, 21), new Date(2026, 10, 21))).toBe('21 Nov 2026');
    expect(formatDateRange(new Date(2026, 10, 21), new Date(2026, 10, 22))).toBe('21 Nov 2026 – 22 Nov 2026');
  });
});

describe('tournamentUrl', () => {
  it('points at the tournament on Badminton Nederland', () => {
    expect(tournamentUrl('ABC')).toBe('https://badmintonnederland.toernooi.nl/sport/tournament?id=ABC');
  });
});
