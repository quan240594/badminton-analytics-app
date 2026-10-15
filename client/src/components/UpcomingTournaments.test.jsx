import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import UpcomingTournaments from './UpcomingTournaments.jsx';

const TOURNAMENTS = [
  { id: 'A', name: 'Open A', dates: ['2026-11-21 00:00', '2026-11-22 23:59'], location: 'Breda' },
  { id: 'B', name: 'Cup B', dates: ['2026-09-05 00:00'] },
];
const NOW = new Date(2026, 9, 14);
const PARTNER = { id: 'p', name: 'Partner, One', url: 'https://badmintonnederland.toernooi.nl/player-profile/G-P' };
const ENTRIES = [
  { id: 'A', events: [{ name: 'HE 7', partners: [] }, { name: 'HD 7', partners: [PARTNER] }] },
  { id: 'B', events: [{ name: 'HE 1', partners: [] }] },
];

describe('UpcomingTournaments', () => {
  it('lists upcoming tournaments with dates, place and events, linked to the tournament', () => {
    render(<UpcomingTournaments entries={ENTRIES} tournaments={TOURNAMENTS} now={NOW} />);

    expect(screen.getByText('Upcoming tournaments')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Tournament', 'Date', 'Location', 'Events']);
    const row = screen.getByRole('link', { name: 'Open A' }).closest('tr');
    expect(screen.getByRole('link', { name: 'Open A' })).toHaveAttribute('href', expect.stringContaining('/sport/tournament?id=A'));
    expect(within(row).getAllByRole('cell').slice(0, 3).map((c) => c.textContent)).toEqual(['Open A', '21 Nov 2026 – 22 Nov 2026', 'Breda']);
    expect([...row.querySelectorAll('.event-line')].map((line) => line.textContent)).toEqual(['HE 7', 'HD 7 with Partner, One']);
    expect(within(row).getByRole('link', { name: 'Partner, One' })).toHaveAttribute('href', PARTNER.url);
    expect(screen.queryByText('Cup B')).not.toBeInTheDocument();
  });

  it('fills a missing location or event list with a dash', () => {
    const tournaments = [{ id: 'C', name: 'Cup C', dates: ['2026-12-01 00:00'] }];
    render(<UpcomingTournaments entries={[{ id: 'C', events: [] }]} tournaments={tournaments} now={NOW} />);

    const row = screen.getByRole('link', { name: 'Cup C' }).closest('tr');
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Cup C', '1 Dec 2026', '-', '-']);
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
