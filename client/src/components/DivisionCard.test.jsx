import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DivisionCard from './DivisionCard.jsx';

describe('DivisionCard', () => {
  it('renders the division and year when provided', () => {
    render(<DivisionCard highestDivision={{ division: 'Eredivisie', year: 2025 }} />);
    expect(screen.getByText('Eredivisie')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
  });

  it('renders dashes when no division data is available', () => {
    render(<DivisionCard highestDivision={null} />);
    expect(screen.getAllByText('-')).toHaveLength(2);
  });
});
