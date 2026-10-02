import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PlayerStatsCard from './PlayerStatsCard.jsx';

const player = {
  singlesPlayed: 10, singlesWon: 5, singlesWinRate: 0.5,
  singlesSetsPlayed: 20, singlesSetsWon: 12, singlesSetsWinRate: 0.6,
  singlesPointsPlayed: 200, singlesPointsWon: 110, singlesPointsWinRate: 0.55,
  doublesPlayed: 0, doublesWon: 0, doublesWinRate: null,
  doublesSetsPlayed: 0, doublesSetsWon: 0, doublesSetsWinRate: null,
  doublesPointsPlayed: 0, doublesPointsWon: 0, doublesPointsWinRate: null,
  mixedPlayed: 0, mixedWon: 0, mixedWinRate: null,
  mixedSetsPlayed: 0, mixedSetsWon: 0, mixedSetsWinRate: null,
  mixedPointsPlayed: 0, mixedPointsWon: 0, mixedPointsWinRate: null,
};

describe('PlayerStatsCard', () => {
  it('renders nothing when player is missing', () => {
    const { container } = render(<PlayerStatsCard player={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an empty total for a player without any matches', () => {
    render(<PlayerStatsCard player={{}} />);

    const totals = within(screen.getByText('Total').closest('tr')).getAllByRole('cell');
    expect(totals.map((cell) => cell.textContent)).toEqual(['Total', '0 (—)', '0 (—)', '0 (—)']);
  });

  it('treats missing stat fields as zero in the totals', () => {
    render(<PlayerStatsCard player={{ singlesPlayed: 3 }} />);

    const totals = within(screen.getByText('Total').closest('tr')).getAllByRole('cell');
    expect(totals.map((cell) => cell.textContent)).toEqual(['Total', '3 (0%)', '0 (—)', '0 (—)']);
  });

  it('renders per-discipline and total rows with formatted percentages', () => {
    render(<PlayerStatsCard player={player} />);
    expect(screen.getAllByText('10 (50%)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0 (—)').length).toBeGreaterThan(0);
    expect(screen.getByText('Total')).toBeInTheDocument();
  });
});
