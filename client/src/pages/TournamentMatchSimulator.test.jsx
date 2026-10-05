import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TournamentMatchSimulator from './TournamentMatchSimulator.jsx';

const fetchTournaments = vi.fn();
const simulateTournamentMatch = vi.fn();
vi.mock('../api.js', () => ({
  fetchTournaments: (...args) => fetchTournaments(...args),
  simulateTournamentMatch: (...args) => simulateTournamentMatch(...args),
}));

const TOURNAMENT = {
  id: 't1',
  name: 'Test Open 2026',
  players: [
    { id: 'p1', name: 'Alice Alpha', club: 'Club A', nationalRanking: { singles: { rank: 5, points: 900 } } },
    { id: 'p2', name: 'Bob Beta', club: 'Club B', nationalRanking: null },
    { id: 'p3', name: 'Cara Gamma', club: 'Club C', nationalRanking: { singles: { rank: 42, points: 300 } } },
    { id: 'p4', name: 'Dana Delta', club: 'Club D', nationalRanking: null },
  ],
  draws: [
    {
      draw_id: 'd1',
      name: 'HE',
      standings: [
        { players: [{ player_id: 'p1' }] },
        { players: [{ player_id: 'p2' }] },
        { players: [{ player_id: 'p3' }] },
      ],
      matches: [],
    },
  ],
};

async function pickTournament() {
  const tournamentInput = screen.getByPlaceholderText('Search tournament...');
  fireEvent.focus(tournamentInput);
  fireEvent.change(tournamentInput, { target: { value: 'test open' } });
  fireEvent.mouseDown(await screen.findByText('Test Open 2026'));
}

async function selectTournamentAndPlayer(playerName) {
  render(<TournamentMatchSimulator />);
  await pickTournament();

  const input = screen.getByPlaceholderText('Search player...');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: playerName } });
  fireEvent.mouseDown(await screen.findByText(playerName));
}

describe('TournamentMatchSimulator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    fetchTournaments.mockResolvedValue([TOURNAMENT]);
  });

  it('shows every draw the player is in, simulated against each other entrant', async () => {
    simulateTournamentMatch.mockImplementation((tournamentId, discipline, playerId, opponentId) => {
      if (opponentId === 'p2') {
        return Promise.resolve({ error: true, message: 'Bob Beta has no national ranking data to simulate this match with.' });
      }
      return Promise.resolve({
        sideB: { name: 'Cara Gamma', ranking: { rank: 42, points: 300 } },
        winProbabilityA: 0.7,
        winProbabilityB: 0.3,
      });
    });

    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText('#5')).toBeInTheDocument();
    expect(await screen.findByText('HE')).toBeInTheDocument();
    expect(await screen.findByText(/Bob Beta has no national ranking data/)).toBeInTheDocument();
    expect(await screen.findByText(/vs Cara Gamma/)).toBeInTheDocument();
    expect(simulateTournamentMatch).toHaveBeenCalledWith('t1', 'singles', 'p1', 'p2');
    expect(simulateTournamentMatch).toHaveBeenCalledWith('t1', 'singles', 'p1', 'p3');
  });

  it("tells the user when the selected player isn't entered in any draw", async () => {
    await selectTournamentAndPlayer('Dana Delta');

    expect(await screen.findByText("This player isn't in any scraped draw for this tournament yet.")).toBeInTheDocument();
    expect(simulateTournamentMatch).not.toHaveBeenCalled();
  });
});

describe('TournamentMatchSimulator - draws and persistence', () => {
  const STORAGE_KEY = 'badminton-app-tournament-state';
  const WIN_RESULT = {
    sideB: { name: 'Cara Gamma', ranking: { rank: 42, points: 300 } },
    winProbabilityA: 0.7,
    winProbabilityB: 0.3,
  };
  const standings = (...ids) => ids.map((id) => ({ players: [{ player_id: id }] }));
  const withDraws = (draws) => fetchTournaments.mockResolvedValue([{ ...TOURNAMENT, draws }]);

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    fetchTournaments.mockResolvedValue([TOURNAMENT]);
    simulateTournamentMatch.mockResolvedValue(WIN_RESULT);
  });

  it('restores the saved tournament and player', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournamentId: 't1', playerId: 'p1' }));
    render(<TournamentMatchSimulator />);

    expect(await screen.findByText('#5')).toBeInTheDocument();
    expect(await screen.findAllByText(/vs Cara Gamma/)).toHaveLength(2);
    expect(screen.getByPlaceholderText('Search tournament...')).toHaveValue('Test Open 2026');
  });

  it('filters the tournament list by what is typed', async () => {
    render(<TournamentMatchSimulator />);
    await waitFor(() => expect(fetchTournaments).toHaveBeenCalled());

    const input = screen.getByPlaceholderText('Search tournament...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });

    expect(await screen.findByText('No tournaments found')).toBeInTheDocument();
  });

  it('ignores malformed saved state', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    render(<TournamentMatchSimulator />);

    await waitFor(() => expect(fetchTournaments).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Search tournament...')).toHaveValue('');
  });

  it('says so when the saved tournament has no scraped data', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournamentId: 'gone', playerId: '' }));
    render(<TournamentMatchSimulator />);

    expect(await screen.findByText('No entrants/draws scraped for this tournament yet.')).toBeInTheDocument();
  });

  it.each([
    ['GD', 'mixed'], ['Gemengd A', 'mixed'], ['ME', 'singles'], ['Enkel B', 'singles'], ['JD', 'doubles'], ['Dubbel C', 'doubles'],
  ])('infers the discipline of a "%s" draw as %s', async (name, discipline) => {
    withDraws([{ draw_id: 'd1', name, standings: standings('p1', 'p3') }]);

    await selectTournamentAndPlayer('Alice Alpha');

    await waitFor(() => expect(simulateTournamentMatch).toHaveBeenCalledWith('t1', discipline, 'p1', 'p3'));
  });

  it.each([['an unrecognised name', 'XYZ'], ['no name', undefined]])('skips a draw with %s', async (_case, name) => {
    withDraws([{ draw_id: 'd1', name, standings: standings('p1', 'p3') }]);

    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText("This player isn't in any scraped draw for this tournament yet.")).toBeInTheDocument();
    expect(simulateTournamentMatch).not.toHaveBeenCalled();
  });

  it('finds opponents from knockout matches when a draw has no standings', async () => {
    withDraws([{
      draw_id: 'k1',
      name: 'HE',
      matches: [{ sides: [{ players: [{ player_id: 'p1' }] }, { players: [{ player_id: 'p3' }] }] }, { sides: [{}] }, {}],
    }]);

    await selectTournamentAndPlayer('Alice Alpha');

    await waitFor(() => expect(simulateTournamentMatch).toHaveBeenCalledWith('t1', 'singles', 'p1', 'p3'));
    expect(simulateTournamentMatch).toHaveBeenCalledTimes(1);
  });

  it('copes with a tournament that has no draws at all', async () => {
    withDraws(undefined);

    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText("This player isn't in any scraped draw for this tournament yet.")).toBeInTheDocument();
  });

  it('shows the error when a simulation fails', async () => {
    simulateTournamentMatch.mockRejectedValue(new Error('unknown player id(s)'));

    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText('unknown player id(s)')).toBeInTheDocument();
  });

  it('shows the error when the tournaments cannot be loaded', async () => {
    fetchTournaments.mockRejectedValue(new Error('bundle missing'));
    render(<TournamentMatchSimulator />);

    expect(await screen.findByText('bundle missing')).toBeInTheDocument();
  });
});
