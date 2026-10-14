import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfileStatsCard from './ProfileStatsCard.jsx';

describe('ProfileStatsCard', () => {
  it('renders nothing without a known profile', () => {
    const { container } = render(<ProfileStatsCard profile={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the disciplines that have statistics, skipping the others', () => {
    const stats = {
      total: { career: { wins: 10, losses: 5 }, thisYear: { wins: 4, losses: 1 } },
      mixed: { career: { wins: 2, losses: 2 }, thisYear: { wins: 0, losses: 0 } },
    };
    render(<ProfileStatsCard profile={{ guid: 'G', stats }} />);

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Mixed')).toBeInTheDocument();
    expect(screen.queryByText('Singles')).not.toBeInTheDocument();
    expect(screen.getByText('10–5 (67%)')).toBeInTheDocument();
    expect(screen.getByText('0–0')).toBeInTheDocument();
  });

  it('shows only the profile link when no statistics were read', () => {
    render(<ProfileStatsCard profile={{ guid: 'G', stats: {} }} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View profile/ })).toHaveAttribute('href', expect.stringContaining('/player-profile/G'));
  });

  it('shows every recent match, including several on the same day, without key clashes', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const form = [
      { date: '2026-10-10', won: false },
      { date: '2026-10-10', won: false },
      { date: '2026-10-10', won: true },
    ];
    render(<ProfileStatsCard profile={{ guid: 'G', stats: { total: { career: { wins: 1, losses: 2 }, form } } }} />);

    expect(screen.getAllByTitle('2026-10-10')).toHaveLength(3);
    expect(screen.getAllByText('L')).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
