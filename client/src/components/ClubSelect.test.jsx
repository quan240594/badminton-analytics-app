import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ClubSelect from './ClubSelect.jsx';

const clubs = ['BC Alpha', 'BC Beta', 'BC Gamma'];

describe('ClubSelect', () => {
  it('shows the current value when closed, and opens with all options on focus', () => {
    const onChange = vi.fn();
    render(<ClubSelect clubs={clubs} value="BC Alpha" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Club filter');
    expect(input).toHaveValue('BC Alpha');

    fireEvent.focus(input);
    expect(screen.getByText('All clubs')).toBeInTheDocument();
    expect(screen.getByText('BC Beta')).toBeInTheDocument();
  });

  it('filters options as the user types', () => {
    render(<ClubSelect clubs={clubs} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Club filter');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'beta' } });

    expect(screen.getByText('BC Beta')).toBeInTheDocument();
    expect(screen.queryByText('BC Alpha')).not.toBeInTheDocument();
  });

  it('shows an empty message when no club matches', () => {
    render(<ClubSelect clubs={clubs} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Club filter');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No clubs found')).toBeInTheDocument();
  });

  it('selects "All clubs" via mousedown, clearing the value', () => {
    const onChange = vi.fn();
    render(<ClubSelect clubs={clubs} value="BC Alpha" onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('Club filter'));
    fireEvent.mouseDown(screen.getByText('All clubs'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('selects a club option via mousedown', () => {
    const onChange = vi.fn();
    render(<ClubSelect clubs={clubs} value="" onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('Club filter'));
    fireEvent.mouseDown(screen.getByText('BC Beta'));
    expect(onChange).toHaveBeenCalledWith('BC Beta');
  });

  it('navigates with arrow keys and selects the active option with Enter', () => {
    const onChange = vi.fn();
    render(<ClubSelect clubs={clubs} value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Club filter');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('BC Alpha');
  });

  it('selects "All clubs" with Enter when the active index is 0', () => {
    const onChange = vi.fn();
    render(<ClubSelect clubs={clubs} value="BC Alpha" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Club filter');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('closes on Escape and ignores keys while closed', () => {
    render(<ClubSelect clubs={clubs} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Club filter');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('All clubs')).not.toBeInTheDocument();
  });

  it('closes on blur after a delay', async () => {
    vi.useFakeTimers();
    render(<ClubSelect clubs={clubs} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Club filter');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.getByText('All clubs')).toBeInTheDocument();
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByText('All clubs')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('ClubSelect - hover', () => {
  it('highlights the hovered option, including "All clubs"', () => {
    render(<ClubSelect clubs={['Club A', 'Club B']} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText('Club filter'));

    fireEvent.mouseEnter(screen.getByText('Club B'));
    expect(screen.getByText('Club B')).toHaveClass('active');

    fireEvent.mouseEnter(screen.getByText('All clubs'));
    expect(screen.getByText('All clubs')).toHaveClass('active');
  });
});
