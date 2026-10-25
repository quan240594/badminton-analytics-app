import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CareerMedalsCard from './CareerMedalsCard.jsx';

describe('CareerMedalsCard', () => {
  it('renders nothing when titleCounts is missing', () => {
    const { container } = render(<CareerMedalsCard titleCounts={null} titleYears={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per year plus a total row, using "-" for zero counts', () => {
    render(
      <CareerMedalsCard
        titleCounts={{
          byYear: { 2024: { gold: 1, silver: 0, bronze: 2 } },
          total: { gold: 1, silver: 0, bronze: 2 },
        }}
        titleYears={[2024]}
      />
    );

    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    const dashes = screen.getAllByText('-');
    expect(dashes).toHaveLength(2);
  });
});
