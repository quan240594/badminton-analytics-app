import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MatchSimulator from './MatchSimulator.jsx';

const isAdminRef = { current: true };
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => ({ isAdmin: isAdminRef.current }) }));

const fetchDataMock = vi.fn();
vi.mock('../hooks/useDataRefresh.js', () => ({
  default: () => ({ refreshState: { running: false, percent: 0, error: null }, showUnchanged: false, fetchData: fetchDataMock }),
}));

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

function makePlayer(id, club, rating) {
  return {
    id, name: id, club,
    singlesRating: rating, singlesPlayed: 10, singlesWinRate: 0.5,
    singlesSetsPlayed: 20, singlesSetsWon: 10, singlesSetsWinRate: 0.5,
    singlesPointsPlayed: 400, singlesPointsWon: 200, singlesPointsWinRate: 0.5,
    doublesRating: rating, doublesPlayed: 0, doublesWinRate: null,
    doublesSetsPlayed: 0, doublesSetsWon: 0, doublesSetsWinRate: null,
    doublesPointsPlayed: 0, doublesPointsWon: 0, doublesPointsWinRate: null,
    mixedRating: 1500, mixedPlayed: 0, mixedWinRate: null,
    mixedSetsPlayed: 0, mixedSetsWon: 0, mixedSetsWinRate: null,
    mixedPointsPlayed: 0, mixedPointsWon: 0, mixedPointsWinRate: null,
    nationalRanking: null,
    highestDivision: null,
    titles: null,
    titleCounts: { byYear: {}, total: { gold: 0, silver: 0, bronze: 0 } },
  };
}

const playersFixture = [
  makePlayer('a1', 'Club A', 1700),
  makePlayer('a2', 'Club A', 1600),
  makePlayer('b1', 'Club B', 1690),
  makePlayer('b2', 'Club B', 1590),
];

const leagueIndexFixture = {
  divisions: {
    'Mannen Veer 2': [
      {
        drawId: '12', division: 'Mannen Veer 2', label: 'Mannen Veer 2 afd. 12',
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
    lastUpdated: '2026-01-01T10:00:00Z',
    poolLabel: 'Bondscompetitie 2026-2027 \u2013 Mannen Veer 2 afd. 12',
    leagueIndex: leagueIndexFixture,
    fetchedDrawIds: ['12'],
    poolRosters: {},
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
  api.simulateSingles.mockResolvedValue({
    playerA: { id: 'a1', name: 'a1', rating: 1700, played: 10, confidence: 'high' },
    playerB: { id: 'b1', name: 'b1', rating: 1690, played: 10, confidence: 'high' },
    winProbabilityA: 0.55,
    winProbabilityB: 0.45,
    headToHead: null,
  });
  api.simulateDoubles.mockResolvedValue({
    teamA: [{ id: 'a1', name: 'a1', rating: 1700, played: 10, confidence: 'high' }, { id: 'a2', name: 'a2', rating: 1600, played: 10, confidence: 'high' }],
    teamB: [{ id: 'b1', name: 'b1', rating: 1690, played: 10, confidence: 'high' }, { id: 'b2', name: 'b2', rating: 1590, played: 10, confidence: 'high' }],
    teamARating: 1650,
    teamBRating: 1640,
    winProbabilityA: 0.52,
    winProbabilityB: 0.48,
    headToHead: null,
  });
});

describe('MatchSimulator', () => {
  it('loads players/meta and renders the subtitle with pool label and timestamp', async () => {
    render(<MatchSimulator />);
    expect(await screen.findByText(/rated players from/)).toBeInTheDocument();
    expect(screen.getByText(/data as of/)).toBeInTheDocument();
  });

  it('simulates a singles match once both sides have one player each', async () => {
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    const sideAInput = within(screen.getByText('Side A').closest('.team')).getByPlaceholderText('Search player...');
    fireEvent.focus(sideAInput);
    fireEvent.mouseDown(screen.getByText('a1'));

    const sideBInput = within(screen.getByText('Side B').closest('.team')).getByPlaceholderText('Search player...');
    fireEvent.focus(sideBInput);
    fireEvent.mouseDown(screen.getByText('b1'));

    await waitFor(() => expect(api.simulateSingles).toHaveBeenCalledWith('a1', 'b1'));
    expect(await screen.findByText('55%')).toBeInTheDocument();
  });

  it('adds a doubles partner and simulates once both sides have two players', async () => {
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);

    const sideAInputs = within(screen.getByText('Side A').closest('.team')).getAllByPlaceholderText('Search player...');
    fireEvent.focus(sideAInputs[0]);
    fireEvent.mouseDown(screen.getByText('a1'));
    fireEvent.focus(sideAInputs[1]);
    fireEvent.mouseDown(screen.getByText('a2'));

    const sideBInputs = within(screen.getByText('Side B').closest('.team')).getAllByPlaceholderText('Search player...');
    fireEvent.focus(sideBInputs[0]);
    fireEvent.mouseDown(screen.getByText('b1'));
    fireEvent.focus(sideBInputs[1]);
    fireEvent.mouseDown(screen.getByText('b2'));

    await waitFor(() => expect(api.simulateDoubles).toHaveBeenCalledWith(['a1', 'a2'], ['b1', 'b2']));
    expect(await screen.findByText('52%')).toBeInTheDocument();
  });

  it('shows a mismatched-side-size error and disables the simulate button', async () => {
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);

    expect(screen.getByText('Both sides must have the same number of players (1 for singles, 2 for doubles).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate Win Rate' })).toBeDisabled();
  });

  it('"Remove partners" collapses both sides back to singles', async () => {
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add doubles partner' })[0]);
    expect(screen.getAllByText('– Remove partner (singles)')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Remove partners' }));
    expect(screen.getAllByText('+ Add doubles partner')).toHaveLength(2);
  });

  it('Clear all resets both sides and club filters', async () => {
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    const clubInputs = screen.getAllByPlaceholderText('Club filter');
    fireEvent.focus(clubInputs[0]);
    fireEvent.mouseDown(screen.getByText('Club A'));

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getAllByPlaceholderText('Club filter')[0]).toHaveValue('');
  });

  it('switching division resets the pool selection', async () => {
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Mannen Veer 3' } });
    expect(screen.getByRole('combobox', { name: /Division/ })).toHaveValue('Mannen Veer 3');
  });

  it('shows the pool-fetch banner and completes a successful admin fetch', async () => {
    api.fetchMeta.mockResolvedValue(metaFixture({ fetchedDrawIds: [] }));
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress.mockResolvedValueOnce({ running: false, percent: 100, error: null });
    api.reloadBundle.mockResolvedValue({ players: playersFixture, meta: metaFixture({ fetchedDrawIds: ['12'] }) });

    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);
    expect(screen.getByText('No data cached yet for this pool.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fetch pool data' }));
    await waitFor(() => expect(api.triggerPoolRefresh).toHaveBeenCalledWith('12'));
    await waitFor(() => expect(screen.queryByText('No data cached yet for this pool.')).not.toBeInTheDocument());
  });

  it('shows a non-admin fallback message in the pool-fetch banner', async () => {
    isAdminRef.current = false;
    api.fetchMeta.mockResolvedValue(metaFixture({ fetchedDrawIds: [] }));

    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);
    expect(screen.getByText('Ask an admin to fetch it.')).toBeInTheDocument();
  });

  it('surfaces the error message when simulation fails', async () => {
    api.simulateSingles.mockRejectedValue(new Error('unknown player id(s)'));
    render(<MatchSimulator />);
    await screen.findByText(/rated players from/);

    const sideAInput = within(screen.getByText('Side A').closest('.team')).getByPlaceholderText('Search player...');
    fireEvent.focus(sideAInput);
    fireEvent.mouseDown(screen.getByText('a1'));
    const sideBInput = within(screen.getByText('Side B').closest('.team')).getByPlaceholderText('Search player...');
    fireEvent.focus(sideBInput);
    fireEvent.mouseDown(screen.getByText('b1'));

    expect(await screen.findByText('unknown player id(s)')).toBeInTheDocument();
  });
});
