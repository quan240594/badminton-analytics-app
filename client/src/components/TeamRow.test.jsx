import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TeamRow from './TeamRow.jsx';

const TEAMS = [
  { club: 'Club A', squad: 'M1' },
  { club: 'Club B', squad: 'M1' },
  { club: 'Club B', squad: 'M2' },
];

function renderRow(props = {}) {
  const onTeamFilterChange = vi.fn();
  const view = render(
    <TeamRow clubFilter="Club B" poolTeams={TEAMS} teamFilter={null} onTeamFilterChange={onTeamFilterChange} {...props} />
  );
  return { ...view, onTeamFilterChange };
}

describe('TeamRow', () => {
  it.each([
    ['no club is picked', { clubFilter: '' }],
    ['the club has a single team and none is chosen', { clubFilter: 'Club A' }],
    ['the club is not in the pool', { clubFilter: 'Club Z' }],
  ])('renders nothing when %s', (_case, props) => {
    const { container } = renderRow(props);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a select when the club has several teams and reports the choice', () => {
    const { onTeamFilterChange } = renderRow();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'M2' } });

    expect(onTeamFilterChange).toHaveBeenCalledWith('M2');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Team…', 'M1', 'M2']);
  });

  it('shows the chosen team for a single-team club as a plain label', () => {
    renderRow({ clubFilter: 'Club A', teamFilter: 'M1' });

    expect(screen.getByText('M1')).toHaveClass('team-label');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
