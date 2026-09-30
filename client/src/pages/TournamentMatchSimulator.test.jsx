import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

async function selectTournamentAndPlayer(playerName) {
  render(<TournamentMatchSimulator />);
  await screen.findByText('Test Open 2026');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });

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
