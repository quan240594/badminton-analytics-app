import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TitlesCard from './TitlesCard.jsx';

describe('TitlesCard', () => {
  it('renders nothing when titles is missing', () => {
    const { container } = render(<TitlesCard titles={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a medal emoji for known statuses and the raw status otherwise', () => {
    render(
      <TitlesCard
        titles={{
          singles: { status: 'Winner', year: 2025, tournament: 'Open A' },
          doubles: { status: 'Weird', year: 2024, tournament: 'Open B' },
          mixed: null,
        }}
      />
    );

    expect(screen.getByTitle('Winner')).toHaveTextContent('🥇');
    expect(screen.getByTitle('Weird')).toHaveTextContent('Weird');
    expect(screen.getByText('Open A')).toBeInTheDocument();
  });
});
