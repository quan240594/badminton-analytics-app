import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import MatchSimulator from './MatchSimulator.jsx';
import { makePlayer, metaFixture, pickOption } from '../testFixtures.js';

const STORAGE_KEY = 'badminton-app-state';
const MODE_KEY = 'badminton-app-simulator-mode';

const isAdminRef = { current: true };
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => ({ isAdmin: isAdminRef.current }) }));

const fetchDataMock = vi.fn();
const refreshHook = { onRefreshed: null };
vi.mock('../hooks/useDataRefresh.js', () => ({
  default: (onRefreshed) => {
    refreshHook.onRefreshed = onRefreshed;
    return { refreshState: { running: false, percent: 0, error: null }, showUnchanged: false, fetchData: fetchDataMock };
  },
}));

vi.mock('./TournamentMatchSimulator.jsx', async () => {
  const { createElement } = await import('react');
  return { default: () => createElement('div', null, 'tournament-simulator') };
});

const api = vi.hoisted(() => ({
  fetchPlayers: vi.fn(),
  fetchMeta: vi.fn(),
  simulateSingles: vi.fn(),
  simulateDoubles: vi.fn(),
  triggerPoolRefresh: vi.fn(),
  fetchPoolRefreshProgress: vi.fn(),
  triggerGithubWorkflowPoolRefresh: vi.fn(),
  pollGithubWorkflowRun: vi.fn(),
  reloadBundle: vi.fn(),
}));
vi.mock('../api.js', () => api);

const playersFixture = [
  makePlayer('a1', 'Club A', 1700),
  makePlayer('a2', 'Club A', 1600),
  makePlayer('b1', 'Club B', 1690),
  makePlayer('b2', 'Club B', 1590),
];

const detail = (id, rating) => ({ id, name: id, rating, played: 10, confidence: 'high' });

async function renderPage() {
  await act(async () => {
    render(<MatchSimulator />);
  });
}

const side = (name) => within(screen.getByText(name).closest('.team'));
const clubInput = (index) => screen.getAllByPlaceholderText('Club filter')[index];

function pickPlayers(sideName, ...names) {
  side(sideName).getAllByPlaceholderText('Search player...').forEach((input, i) => pickOption(input, names[i]));
}

const addPartners = () => {
  fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  isAdminRef.current = true;
  api.fetchPlayers.mockResolvedValue(playersFixture);
  api.fetchMeta.mockResolvedValue(metaFixture());
  api.simulateSingles.mockResolvedValue({
    playerA: detail('a1', 1700), playerB: detail('b1', 1690),
    winProbabilityA: 0.55, winProbabilityB: 0.45, headToHead: null,
  });
  api.simulateDoubles.mockResolvedValue({
    teamA: [detail('a1', 1700), detail('a2', 1600)], teamB: [detail('b1', 1690), detail('b2', 1590)],
    teamARating: 1650, teamBRating: 1640, winProbabilityA: 0.52, winProbabilityB: 0.48, headToHead: null,
  });
});

describe('MatchSimulator', () => {
  it('loads players/meta and renders the subtitle with pool label and timestamp', async () => {
    await renderPage();
    expect(screen.getByText(/4 rated players from/)).toBeInTheDocument();
    expect(screen.getByText(/data as of/)).toBeInTheDocument();
  });

  it('falls back to a generic pool label when meta has none', async () => {
    api.fetchMeta.mockResolvedValue({});
    await renderPage();
    expect(screen.getByText(/rated players from your league pool/)).toBeInTheDocument();
    expect(screen.queryByText(/data as of/)).not.toBeInTheDocument();
  });

  it('keeps working when the meta fetch fails', async () => {
    api.fetchMeta.mockRejectedValue(new Error('no meta'));
    await renderPage();
    expect(screen.getByText(/4 rated players/)).toBeInTheDocument();
  });

  it('simulates a singles match once both sides have one player each', async () => {
    await renderPage();

    pickPlayers('Side A', 'a1');
    pickPlayers('Side B', 'b1');

    await waitFor(() => expect(api.simulateSingles).toHaveBeenCalledWith('a1', 'b1'));
    expect(await screen.findByText('55%')).toBeInTheDocument();
  });

  it('adds a doubles partner and simulates once both sides have two players', async () => {
    await renderPage();
    addPartners();

    pickPlayers('Side A', 'a1', 'a2');
    pickPlayers('Side B', 'b1', 'b2');

    await waitFor(() => expect(api.simulateDoubles).toHaveBeenCalledWith(['a1', 'a2'], ['b1', 'b2']));
    expect(await screen.findByText('52%')).toBeInTheDocument();
  });

  it('shows a mismatched-side-size error and disables the simulate button', async () => {
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);

    expect(screen.getByText('Both sides must have the same number of players (1 for singles, 2 for doubles).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate Win Rate' })).toBeDisabled();
  });

  it('removes a single side\'s partner and both partners at once', async () => {
    await renderPage();
    addPartners();
    expect(screen.getAllByText('– Remove partner (singles)')).toHaveLength(2);

    fireEvent.click(screen.getAllByText('– Remove partner (singles)')[0]);
    expect(screen.getAllByText('+ Add doubles partner')).toHaveLength(1);

    fireEvent.click(screen.getByText('+ Add doubles partner'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove partners' }));
    expect(screen.getAllByText('+ Add doubles partner')).toHaveLength(2);
  });

  it('re-runs the simulation from the button and shows its loading label', async () => {
    let resolveSimulation;
    api.simulateSingles.mockReturnValue(new Promise((resolve) => { resolveSimulation = resolve; }));
    await renderPage();
    pickPlayers('Side A', 'a1');
    pickPlayers('Side B', 'b1');

    expect(await screen.findByRole('button', { name: 'Simulating…' })).toBeDisabled();
    await act(async () => resolveSimulation({
      playerA: detail('a1', 1700), playerB: detail('b1', 1690), winProbabilityA: 0.7, winProbabilityB: 0.3, headToHead: null,
    }));

    expect(await screen.findByText('70%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate Win Rate' }));
    await waitFor(() => expect(api.simulateSingles).toHaveBeenCalledTimes(2));
  });

  it('surfaces the error message when simulation fails', async () => {
    api.simulateSingles.mockRejectedValue(new Error('unknown player id(s)'));
    await renderPage();

    pickPlayers('Side A', 'a1');
    pickPlayers('Side B', 'b1');

    expect(await screen.findByText('unknown player id(s)')).toBeInTheDocument();
  });

  it('surfaces the error message when the players fetch fails', async () => {
    api.fetchPlayers.mockRejectedValue(new Error('network down'));
    await renderPage();
    expect(screen.getByText('network down')).toBeInTheDocument();
  });

  it('applies a data refresh to the players, timestamp and pool label', async () => {
    await renderPage();

    act(() => refreshHook.onRefreshed({
      players: playersFixture.slice(0, 2),
      meta: { lastUpdated: '2026-02-03T04:05:00Z', poolLabel: 'Refreshed pool' },
    }));

    expect(screen.getByText(/2 rated players from Refreshed pool/)).toBeInTheDocument();
  });
});

describe('MatchSimulator - saved state and mode', () => {
  it('restores the saved sides, club filters and division', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sideA: ['a1'], sideB: ['b1'], division: 'Mannen Veer 2', drawId: '13',
      clubFilterA: 'Club A', teamFilterA: 'M2', clubFilterB: '', teamFilterB: null,
    }));
    await renderPage();

    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('13');
    expect(clubInput(0)).toHaveValue('Club A');
    await waitFor(() => expect(api.simulateSingles).toHaveBeenCalledWith('a1', 'b1'));
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a state without both sides', JSON.stringify({ sideA: ['a1'] })],
  ])('ignores %s in storage', async (_case, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    await renderPage();

    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('12');
    expect(api.simulateSingles).not.toHaveBeenCalled();
  });

  it('shows the tournament simulator for the saved mode and switches between modes', async () => {
    localStorage.setItem(MODE_KEY, 'tournament');
    await renderPage();
    expect(screen.getByText('tournament-simulator')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'League match simulator' }));

    expect(screen.queryByText('tournament-simulator')).not.toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBe('league');

    fireEvent.click(screen.getByRole('button', { name: 'Tournament match simulator' }));
    expect(screen.getByText('tournament-simulator')).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBe('tournament');
  });
});

describe('MatchSimulator - pools and clubs', () => {
  it('Clear all resets both sides and club filters', async () => {
    await renderPage();
    pickOption(clubInput(0), 'Club A');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(clubInput(0)).toHaveValue('');
  });

  it('switching division picks its first pool, or disables the pool select when it has none', async () => {
    await renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Mannen Veer 3' } });
    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('20');

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Mannen Nylon 1' } });
    expect(screen.getByRole('combobox', { name: /Pool/ })).toBeDisabled();
  });

  it('switching pool clears the sides and club filters', async () => {
    await renderPage();
    pickOption(clubInput(0), 'Club A');

    fireEvent.change(screen.getByRole('combobox', { name: /Pool/ }), { target: { value: '13' } });

    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('13');
    expect(clubInput(0)).toHaveValue('');
  });

  it('lets the user pick a squad for a multi-team club and auto-selects it for a single-team club', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: /Pool/ }), { target: { value: '13' } });

    pickOption(clubInput(0), 'Club A');
    const teamSelect = screen.getByRole('combobox', { name: '' });
    fireEvent.change(teamSelect, { target: { value: 'M2' } });
    expect(teamSelect).toHaveValue('M2');

    pickOption(clubInput(1), 'Club B');
    expect(screen.getByText('M1', { selector: '.team-label' })).toBeInTheDocument();
  });

  it('drops a selected player who no longer matches a newly chosen club filter', async () => {
    await renderPage();
    pickPlayers('Side A', 'a1');

    pickOption(clubInput(0), 'Club B');
    expect(side('Side A').getByPlaceholderText('Search player...')).toHaveValue('');

    pickPlayers('Side A', 'b1');
    pickOption(clubInput(0), 'All clubs');
    expect(side('Side A').getByPlaceholderText('Search player...')).toHaveValue('b1');
  });

  it('only offers the pool roster when one is known', async () => {
    api.fetchMeta.mockResolvedValue(metaFixture({ poolRosters: { 12: ['a1', 'b1'] } }));
    await renderPage();

    fireEvent.focus(side('Side A').getByPlaceholderText('Search player...'));

    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['a1 Club A', 'b1 Club B']);
  });

  it('keeps a saved pool instead of the current pool from meta', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sideA: [''], sideB: [''], drawId: '13' }));
    await renderPage();
    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('13');
  });

  it('lists a medal row only for years in which a selected player won something', async () => {
    const medals = (gold) => ({ byYear: { 2024: { gold, silver: 0, bronze: 0 }, 2025: { gold: 0, silver: 0, bronze: 0 } }, total: { gold, silver: 0, bronze: 0 } });
    api.fetchPlayers.mockResolvedValue([
      makePlayer('a1', 'Club A', 1700, { titleCounts: medals(2) }),
      makePlayer('a2', 'Club A', 1600, { titleCounts: undefined }),
      ...playersFixture.slice(2),
    ]);
    await renderPage();

    pickPlayers('Side A', 'a1');
    expect(screen.getAllByText('2024').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('2025')).toHaveLength(0);

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);
    pickOption(side('Side A').getAllByPlaceholderText('Search player...')[1], 'a2');
    expect(screen.getAllByText('2024').length).toBeGreaterThan(0);
  });
});

describe('MatchSimulator - pool fetch', () => {
  beforeEach(() => {
    api.fetchMeta.mockResolvedValue(metaFixture({ fetchedDrawIds: [] }));
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress.mockResolvedValue({ running: false, percent: 100, error: null });
  });

  it.each([
    ['all meta fields', metaFixture({ fetchedDrawIds: ['12'] }), false],
    ['no meta fields', {}, true],
  ])('applies the reloaded bundle with %s', async (_case, meta, bannerStays) => {
    api.reloadBundle.mockResolvedValue({ players: playersFixture.slice(0, 2), meta });
    await renderPage();
    expect(screen.getByText('No data cached yet for this pool.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fetch pool data' }));

    await waitFor(() => expect(screen.getByText(/2 rated players/)).toBeInTheDocument());
    expect(api.triggerPoolRefresh).toHaveBeenCalledWith('12');
    expect(Boolean(screen.queryByText('No data cached yet for this pool.'))).toBe(bannerStays);
  });

  it('shows a non-admin fallback message in the pool-fetch banner', async () => {
    isAdminRef.current = false;
    await renderPage();
    expect(screen.getByText('Ask an admin to fetch it.')).toBeInTheDocument();
  });
});
