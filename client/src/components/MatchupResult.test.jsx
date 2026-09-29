import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MatchupResult from './MatchupResult.jsx';

describe('MatchupResult', () => {
  it('renders nothing when result is missing', () => {
    const { container } = render(<MatchupResult result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a singles matchup with head-to-head record', () => {
    render(
      <MatchupResult
        result={{
          playerA: { id: 'a', name: 'Alice', rating: 1600, played: 10, confidence: 'high' },
          playerB: { id: 'b', name: 'Bob', rating: 1500, played: 3, confidence: 'low' },
          winProbabilityA: 0.7,
          winProbabilityB: 0.3,
          headToHead: { playerAWins: 2, playerBWins: 1 },
        }}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('Head-to-head: 2 - 1')).toBeInTheDocument();
  });

  it('renders a doubles matchup, hides percentage labels under 8%, and shows no-h2h message', () => {
    render(
      <MatchupResult
        result={{
          teamA: [
            { id: 'a1', name: 'Alice', confidence: 'high', played: 10 },
            { id: 'a2', name: 'Ann', confidence: 'medium', played: 6 },
          ],
          teamB: [
            { id: 'b1', name: 'Bob', confidence: 'low', played: 1 },
            { id: 'b2', name: 'Bea', confidence: 'low', played: 0 },
          ],
          teamARating: 1600,
          teamBRating: 1500,
          winProbabilityA: 0.95,
          winProbabilityB: 0.05,
          headToHead: null,
        }}
      />
    );

    expect(screen.getByText('Alice & Ann')).toBeInTheDocument();
    expect(screen.getByText('Bob & Bea')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText('No recorded head-to-head matches')).toBeInTheDocument();
  });
});
