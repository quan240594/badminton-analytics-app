import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PageHeader from './PageHeader.jsx';

describe('PageHeader', () => {
  it('renders title/subtitle and wires up the Clear all button', () => {
    const onClearAll = vi.fn();
    render(
      <PageHeader
        title="Title"
        subtitle="Sub"
        onClearAll={onClearAll}
        refreshState={{ running: false }}
        isAdmin={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Fetch data/ })).not.toBeInTheDocument();
  });

  it('shows the admin refresh control with progress bar and error', () => {
    const onFetchData = vi.fn();
    render(
      <PageHeader
        title="Title"
        subtitle="Sub"
        onClearAll={() => {}}
        refreshState={{ running: true, percent: 42.4, error: 'boom' }}
        showUnchanged
        onFetchData={onFetchData}
        isAdmin
      />
    );

    expect(screen.getByText('Data already up to date')).toBeInTheDocument();
    const fetchButton = screen.getByRole('button', { name: 'Fetching…' });
    expect(fetchButton).toBeDisabled();
    fireEvent.click(fetchButton);
    expect(onFetchData).not.toHaveBeenCalled();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('enables the fetch button and calls onFetchData when not already running', () => {
    const onFetchData = vi.fn();
    render(
      <PageHeader
        title="Title"
        subtitle="Sub"
        onClearAll={() => {}}
        refreshState={{ running: false, percent: 0, error: null }}
        onFetchData={onFetchData}
        isAdmin
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fetch data' }));
    expect(onFetchData).toHaveBeenCalled();
  });
});
