import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PoolFetchBanner from './PoolFetchBanner.jsx';

const IDLE = { running: false, percent: 0, error: null };

function renderBanner(props = {}) {
  const onFetch = vi.fn();
  const view = render(
    <PoolFetchBanner drawId="12" fetchedDrawIds={[]} poolFetchState={IDLE} isAdmin onFetch={onFetch} {...props} />
  );
  return { ...view, onFetch };
}

describe('PoolFetchBanner', () => {
  it.each([
    ['no pool is selected', { drawId: '' }],
    ['the pool is already cached', { fetchedDrawIds: ['12'] }],
  ])('renders nothing when %s', (_case, props) => {
    const { container } = renderBanner(props);
    expect(container).toBeEmptyDOMElement();
  });

  it('lets an admin fetch the uncached pool', () => {
    const { onFetch } = renderBanner();

    expect(screen.getByText('No data cached yet for this pool.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch pool data' }));

    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it('tells a non-admin to ask an admin instead', () => {
    renderBanner({ isAdmin: false });

    expect(screen.getByText('Ask an admin to fetch it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch pool data' })).not.toBeInTheDocument();
  });

  it('shows the progress bar instead of the prompt while fetching', () => {
    renderBanner({ poolFetchState: { running: true, percent: 60, error: null } });

    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('No data cached yet for this pool.')).not.toBeInTheDocument();
  });

  it('shows the fetch error', () => {
    renderBanner({ poolFetchState: { running: false, percent: 0, error: 'boom' } });

    expect(screen.getByText('boom')).toHaveClass('error');
  });
});
