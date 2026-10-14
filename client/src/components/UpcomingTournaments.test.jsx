import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UpcomingTournaments from './UpcomingTournaments.jsx';

const TOURNAMENTS = [
  { id: 'A', name: 'Open A', dates: ['2026-11-21 00:00', '2026-11-22 23:59'], location: 'Breda' },
  { id: 'B', name: 'Cup B', dates: ['2026-09-05 00:00'] },
];
const NOW = new Date(2026, 9, 14);
const ENTRIES = [{ id: 'A', events: ['HE 7', 'HD 7'] }, { id: 'B', events: ['HE 1'] }];

describe('UpcomingTournaments', () => {
  it('lists upcoming tournaments with dates, place and events, linked to the tournament', () => {
    render(<UpcomingTournaments entries={ENTRIES} tournaments={TOURNAMENTS} now={NOW} />);

    expect(screen.getByText('Upcoming tournaments')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open A' })).toHaveAttribute('href', expect.stringContaining('/sport/tournament?id=A'));
    expect(screen.getByText('21 Nov 2026 – 22 Nov 2026 · Breda · HE 7, HD 7')).toBeInTheDocument();
    expect(screen.queryByText('Cup B')).not.toBeInTheDocument();
  });

  it('says none are known when there is nothing upcoming', () => {
    render(<UpcomingTournaments entries={[{ id: 'B', events: [] }]} tournaments={TOURNAMENTS} now={NOW} />);
    expect(screen.getByText('None known yet')).toBeInTheDocument();
  });

  it('collapses next to an opponent, with a count, and is absent when there is nothing upcoming', () => {
    const { container, rerender } = render(<UpcomingTournaments entries={ENTRIES} tournaments={TOURNAMENTS} now={NOW} collapsible title="Q, One: upcoming tournaments" />);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Q, One: upcoming tournaments (1)')).toBeInTheDocument();

    rerender(<UpcomingTournaments entries={[]} tournaments={TOURNAMENTS} now={NOW} collapsible />);
    expect(container).toBeEmptyDOMElement();
  });
});
