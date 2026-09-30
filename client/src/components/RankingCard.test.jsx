import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RankingCard from './RankingCard.jsx';

describe('RankingCard', () => {
  it('renders nothing when nationalRanking is missing', () => {
    const { container } = render(<RankingCard nationalRanking={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders rank, points and pct-of-top per discipline, and a summed total', () => {
    render(
      <RankingCard
        nationalRanking={{
          singles: { rank: 3, points: 500, topPoints: 1000, topName: 'Top', pctOfTop: 0.5 },
          doubles: null,
          mixed: null,
        }}
      />
    );

    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('50% of Top')).toBeInTheDocument();
    expect(screen.getAllByText('500')).toHaveLength(2);
  });
});
