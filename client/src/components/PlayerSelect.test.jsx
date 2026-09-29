import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlayerSelect from './PlayerSelect.jsx';

const players = [
  { id: 'p1', name: 'Alice', club: 'BC Alpha' },
  { id: 'p2', name: 'Bob', club: 'BC Beta' },
  { id: 'p3', name: 'Carl', club: 'BC Gamma' },
];

describe('PlayerSelect', () => {
  it('shows the selected player name and club when closed', () => {
    render(<PlayerSelect label="Player A" players={players} value="p1" onChange={() => {}} />);
    expect(screen.getByText('Player A')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search player...')).toHaveValue('Alice');
    expect(screen.getByText('Club: BC Alpha')).toBeInTheDocument();
  });

  it('hides the club line when showClub is false', () => {
    render(<PlayerSelect label="Player A" players={players} value="p1" onChange={() => {}} showClub={false} />);
    expect(screen.queryByText('Club: BC Alpha')).not.toBeInTheDocument();
  });

  it('excludes ids in excludeIds from the option list while opened', () => {
    render(
      <PlayerSelect label="Player B" players={players} value="" onChange={() => {}} excludeIds={['p2']} />
    );
    fireEvent.focus(screen.getByPlaceholderText('Search player...'));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('filters by query and shows an empty message when nothing matches', () => {
    render(<PlayerSelect label="Player A" players={players} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No players found')).toBeInTheDocument();
  });

  it('shows a substitute tag using isSubstitute and selects on mousedown', () => {
    const onChange = vi.fn();
    render(
      <PlayerSelect
        label="Player A"
        players={players}
        value=""
        onChange={onChange}
        isSubstitute={(p) => p.id === 'p2'}
      />
    );
    fireEvent.focus(screen.getByPlaceholderText('Search player...'));
    expect(screen.getByText('(Sub)')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Bob'));
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('shows the detail badge only when a player is selected and closed', () => {
    render(<PlayerSelect label="Player A" players={players} value="p1" onChange={() => {}} detail="1600" />);
    expect(screen.getByText('1600')).toBeInTheDocument();
  });

  it('navigates with arrow keys and selects the active option with Enter', () => {
    const onChange = vi.fn();
    render(<PlayerSelect label="Player A" players={players} value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('closes on Escape', () => {
    render(<PlayerSelect label="Player A" players={players} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('applies the mirrored row class when mirrored is true', () => {
    render(<PlayerSelect label="Player A" players={players} value="" onChange={() => {}} mirrored />);
    expect(document.querySelector('.player-select-row--mirrored')).not.toBeNull();
  });
});
