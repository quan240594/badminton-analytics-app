import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SimulatorModeTabs from './SimulatorModeTabs.jsx';

const TABS = [
  ['league', 'League match simulator', 'Tournament match simulator'],
  ['tournament', 'Tournament match simulator', 'League match simulator'],
];

describe('SimulatorModeTabs', () => {
  it.each(TABS)('marks only the %s tab as active', (mode, activeName, inactiveName) => {
    render(<SimulatorModeTabs mode={mode} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: activeName })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: inactiveName })).not.toHaveClass('is-active');
  });

  it.each([
    ['League match simulator', 'league'],
    ['Tournament match simulator', 'tournament'],
  ])('reports %s as mode "%s" when clicked', (name, mode) => {
    const onChange = vi.fn();
    render(<SimulatorModeTabs mode="league" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name }));

    expect(onChange).toHaveBeenCalledWith(mode);
  });
});
