import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LeagueDaySimulator from './LeagueDaySimulator.jsx';

const isAdminRef = { current: true };
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => ({ isAdmin: isAdminRef.current }) }));

const fetchDataMock = vi.fn();
const useDataRefreshState = { refreshState: { running: false, percent: 0, error: null }, showUnchanged: false };
vi.mock('../hooks/useDataRefresh.js', () => ({
  default: (onRefreshed) => {
    useDataRefreshState.onRefreshed = onRefreshed;
    return { ...useDataRefreshState, fetchData: fetchDataMock };
  },
}));

const api = vi.hoisted(() => ({
  fetchPlayers: vi.fn(),
  fetchMeta: vi.fn(),
  simulateMatch: vi.fn(),
  triggerPoolRefresh: vi.fn(),
  fetchPoolRefreshProgress: vi.fn(),
  triggerGithubWorkflowPoolRefresh: vi.fn(),
  pollGithubWorkflowRun: vi.fn(),
  reloadBundle: vi.fn(),
}));
vi.mock('../api.js', () => api);

function makePlayer(id, club, singlesRating, doublesRating) {
  return {
    id, name: id, club,
    singlesRating, singlesPlayed: 10, singlesWinRate: 0.5,
    doublesRating, doublesPlayed: 10,
    mixedRating: 1500, mixedPlayed: 0,
    nationalRanking: {},
  };
}

const playersFixture = [
  makePlayer('a1', 'Club A', 1700, 1650),
  makePlayer('a2', 'Club A', 1600, 1550),
  makePlayer('a3', 'Club A', 1500, 1500),
  makePlayer('a4', 'Club A', 1400, 1450),
  makePlayer('b1', 'Club B', 1690, 1640),
  makePlayer('b2', 'Club B', 1590, 1540),
  makePlayer('b3', 'Club B', 1490, 1490),
  makePlayer('b4', 'Club B', 1390, 1440),
];

const leagueIndexFixture = {
  divisions: {
    'Mannen Veer 2': [
      {
        drawId: '12',
        division: 'Mannen Veer 2',
        label: 'Mannen Veer 2 afd. 12',
        teams: [
          { clubId: 'c1', club: 'Club A', squad: 'M1' },
          { clubId: 'c2', club: 'Club B', squad: 'M1' },
        ],
      },
    ],
    'Mannen Veer 3': [
      { drawId: '20', division: 'Mannen Veer 3', label: 'Mannen Veer 3 afd. 20', teams: [] },
    ],
  },
};

function metaFixture(overrides = {}) {
  return {
    leagueIndex: leagueIndexFixture,
    fetchedDrawIds: ['12'],
    poolRosters: {},
    substitutePlayerIds: [],
    playerGenders: {},
    currentPool: { drawId: '12' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  isAdminRef.current = true;
  api.fetchPlayers.mockResolvedValue(playersFixture);
  api.fetchMeta.mockResolvedValue(metaFixture());
  api.simulateMatch.mockResolvedValue({ winProbabilityA: 0.6, winProbabilityB: 0.4, headToHead: null });
});

describe('LeagueDaySimulator', () => {
  it('loads players/meta and renders the division and pool selects', async () => {
    render(<LeagueDaySimulator />);

    expect(await screen.findByText(/8 rated players/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Division/ })).toHaveValue('Mannen Veer 2');
    expect(screen.getByText('Afd. 12')).toBeInTheDocument();
  });

  it('auto-fills every rubber for "closest ratings" and shows a night summary', async () => {
    render(<LeagueDaySimulator />);
    await screen.findByText(/8 rated players/);

    const clubInputs = screen.getAllByPlaceholderText('Club filter');
    fireEvent.focus(clubInputs[0]);
    fireEvent.mouseDown(screen.getByText('Club A'));
    fireEvent.focus(clubInputs[1]);
    fireEvent.mouseDown(screen.getByText('Club B'));

    fireEvent.click(screen.getByRole('button', { name: 'Match players with closest ratings' }));

    await waitFor(() => expect(api.simulateMatch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
  });

  it('clears the lineup and results with Clear all', async () => {
    render(<LeagueDaySimulator />);
    await screen.findByText(/8 rated players/);

    const clubInputs = screen.getAllByPlaceholderText('Club filter');
    fireEvent.focus(clubInputs[0]);
    fireEvent.mouseDown(screen.getByText('Club A'));
    fireEvent.focus(clubInputs[1]);
    fireEvent.mouseDown(screen.getByText('Club B'));
    fireEvent.click(screen.getByRole('button', { name: 'Match players with closest ratings' }));
    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getByText('Fill in players to see the projected result.')).toBeInTheDocument();
    const persisted = JSON.parse(localStorage.getItem('badminton-app-league-day-state'));
    expect(persisted.slots.every((s) => [...s.sideA, ...s.sideB].every((id) => id === ''))).toBe(true);
  });

  it('switching division resets the pool/lineup and shows the new division’s pool', async () => {
    render(<LeagueDaySimulator />);
    await screen.findByText(/8 rated players/);

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Mannen Veer 3' } });

    expect(screen.getByRole('combobox', { name: /Division/ })).toHaveValue('Mannen Veer 3');
    expect(screen.getByText('Afd. 20')).toBeInTheDocument();
  });

  it('shows the pool-fetch banner for an admin when the pool has no cached data, and runs a successful fetch', async () => {
    api.fetchMeta.mockResolvedValue(metaFixture({ fetchedDrawIds: [] }));
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress.mockResolvedValueOnce({ running: false, percent: 100, error: null });
    api.reloadBundle.mockResolvedValue({
      players: playersFixture,
      meta: metaFixture({ fetchedDrawIds: ['12'] }),
    });

    render(<LeagueDaySimulator />);
    await screen.findByText(/8 rated players/);

    expect(screen.getByText('No data cached yet for this pool.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch pool data' }));

    await waitFor(() => expect(api.triggerPoolRefresh).toHaveBeenCalledWith('12'));
    await waitFor(() => expect(screen.queryByText('No data cached yet for this pool.')).not.toBeInTheDocument());
  });

  it('shows a non-admin fallback message instead of the fetch button', async () => {
    isAdminRef.current = false;
    api.fetchMeta.mockResolvedValue(metaFixture({ fetchedDrawIds: [] }));

    render(<LeagueDaySimulator />);
    await screen.findByText(/8 rated players/);

    expect(screen.getByText('Ask an admin to fetch it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch pool data' })).not.toBeInTheDocument();
  });

  it('surfaces the error message when the initial players fetch fails', async () => {
    api.fetchPlayers.mockRejectedValue(new Error('network down'));
    render(<LeagueDaySimulator />);
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });
});
