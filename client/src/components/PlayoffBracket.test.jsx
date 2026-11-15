import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PlayoffBracket from './PlayoffBracket.jsx';

const memberOf = (id) => ({ id, name: { own: 'Alice', rated: 'Bob', missing: 'Cara' }[id] });
const tree = {
  id: 'final', round: 'Finale', selected: true, children: [],
  sides: [
    { id: 'left', candidates: [{ team: ['own'], p: 0.4, winP: null }] },
    { id: 'right', candidates: [{ team: ['rated'], p: null, winP: 0.6 }, { team: ['missing'], p: null, winP: null }] },
  ],
};

describe('final simulation', () => {
  it('shows supported final matchups even when the finalist distribution is unknown', () => {
    render(<PlayoffBracket tree={tree} ownKey="own" memberOf={memberOf} eventName="ME 8" outlook={{ rounds: [{ round: 'Finale', status: 'unknown', reach: 0.21, missing: ['Cara'] }] }} />);
    const table = screen.getByRole('table');
    const bob = within(table).getByRole('rowheader', { name: 'Bob' }).closest('tr');
    expect(bob).toHaveTextContent('60% | 40%');
    const cara = within(table).getByRole('rowheader', { name: 'Cara' }).closest('tr');
    expect(within(cara).getAllByRole('cell').every((cell) => cell.textContent === 'Unknown')).toBe(true);
    expect(screen.getByText('21% chance of getting here')).toBeInTheDocument();
    expect(screen.getByText('Overall final win odds and title chance: Unknown')).toBeInTheDocument();
  });
  it('shows the conditional final result and cumulative title probability', () => {
    render(<PlayoffBracket tree={tree} ownKey="own" memberOf={memberOf} eventName="ME 8" outlook={{ rounds: [{ round: 'Finale', status: 'upcoming', reach: 0.4, winP: 0.6 }] }} />);
    expect(screen.getByText('Win 60% | Lose 40%')).toBeInTheDocument();
    expect(screen.getByText('Chance to win the title: 24%')).toBeInTheDocument();
  });
});