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

    expect(await screen.findByText('No draw data available yet')).toBeInTheDocument();
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

    expect(await screen.findByText('No draw data available yet')).toBeInTheDocument();
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

    expect(await screen.findByText('No draw data available yet')).toBeInTheDocument();
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

describe('TournamentMatchSimulator - mocked draws', () => {
  const doublesRank = (rank, pct) => ({ doubles: { rank, points: 100 * pct, topPoints: 100, pctOfTop: pct } });
  const singlesRank = (rank, pct) => ({ singles: { rank, points: 100 * pct, topPoints: 100, pctOfTop: pct } });
  const BUTTON = { name: 'Simulate matches with mocked draws' };
  const NO_DRAWS_YET = {
    id: 't1',
    name: 'Test Open 2026',
    players: [
      { id: 'me', name: 'Do, Quan', nationalRanking: { ...singlesRank(1761, 0.5), ...doublesRank(1688, 0.5) } },
      { id: 'pa', name: 'Nguyen, Dung', nationalRanking: doublesRank(900, 0.4) },
      { id: 'o1', name: 'One, Opp', nationalRanking: singlesRank(10, 0.9) },
      { id: 'o2', name: 'Two, Opp', nationalRanking: singlesRank(20, 0.8) },
      { id: 'o3', name: 'Three, Opp', nationalRanking: singlesRank(30, 0.7) },
      { id: 'q1', name: 'Q, One', nationalRanking: doublesRank(5, 0.9) },
      { id: 'q2', name: 'Q, Two', nationalRanking: doublesRank(6, 0.8) },
      { id: 'lone', name: 'Lone, Wolf', nationalRanking: null },
    ],
    draws: [],
    events: [
      { event_id: '11', name: 'Categorie 7 -  Heren Enkel', entries: 4, participants: [['me'], ['o1'], ['o2'], ['o3']] },
      { event_id: '13', name: 'Categorie 7 -  Heren Dubbel', entries: 3, participants: [['me', 'pa'], ['q1', 'q2'], ['lone']] },
    ],
  };
  const withEvents = (events, extra = {}) => ({ ...NO_DRAWS_YET, ...extra, events });

  async function selectPlayer(tournament, playerName) {
    fetchTournaments.mockResolvedValue([tournament]);
    render(<TournamentMatchSimulator />);
    await pickTournament();
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: playerName } });
    fireEvent.mouseDown(await screen.findByText(playerName));
  }
  const selectMe = (tournament = NO_DRAWS_YET) => selectPlayer(tournament, 'Do, Quan');
  const clickMock = async () => fireEvent.click(await screen.findByRole('button', BUTTON));

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    simulateTournamentMatch.mockImplementation((_t, _d, _a, b) => Promise.resolve({
      sideB: Array.isArray(b)
        ? { name: 'Q, One / Q, Two', ranking: null, members: [{ ranking: { rank: 5 } }, { ranking: { rank: 6 } }] }
        : { name: `Opp ${b}`, ranking: { rank: 10, points: 90 }, members: [{ ranking: { rank: 10 } }] },
      winProbabilityA: 0.6,
      winProbabilityB: 0.4,
    }));
  });

  it('offers a mocked draw next to the empty-state text, and simulates nothing until it is clicked', async () => {
    await selectMe();

    const text = await screen.findByText('No draw data available yet');
    expect(screen.getByRole('button', BUTTON).parentElement).toContainElement(text);
    expect(simulateTournamentMatch).not.toHaveBeenCalled();
  });

  it('simulates every discipline the player is entered in, with the doubles partner', async () => {
    await selectMe();
    await clickMock();

    expect(await screen.findByText('Categorie 7 - Heren Enkel')).toBeInTheDocument();
    expect(screen.getByText('Categorie 7 - Heren Dubbel')).toBeInTheDocument();
    expect(screen.getAllByText('Mocked draw')).toHaveLength(2);
    expect(screen.getByText('Playing with Nguyen, Dung')).toBeInTheDocument();

    const singles = simulateTournamentMatch.mock.calls.filter(([, d]) => d === 'singles');
    expect(singles.every(([t, , a]) => t === 't1' && a === 'me')).toBe(true);
    expect(singles.map(([, , , b]) => b).sort()).toEqual(['o1', 'o2', 'o3']);
    expect(simulateTournamentMatch.mock.calls.filter(([, d]) => d === 'doubles')).toEqual([['t1', 'doubles', ['me', 'pa'], ['q1', 'q2']]]);
    expect(screen.getByText(/vs Q, One \/ Q, Two — #5 \/ #6/)).toBeInTheDocument();
  });

  it('describes the random pool, counting only complete pairs for doubles', async () => {
    await selectMe();
    await clickMock();

    expect(await screen.findByText('Random pool of 4 (1 pool for 4 players)')).toBeInTheDocument();
    expect(screen.getByText('Random pool of 2 (1 pool for 2 pairs; 1 without a partner left out)')).toBeInTheDocument();
  });

  it('leaves out a doubles entry that has no partner yet', async () => {
    await selectMe();
    await clickMock();
    await screen.findByText('Categorie 7 - Heren Dubbel');

    expect(JSON.stringify(simulateTournamentMatch.mock.calls)).not.toContain('lone');
  });

  it('draws a different random pool on every click', async () => {
    const xs = Array.from({ length: 12 }, (_, i) => `x${i}`);
    const big = withEvents(
      [{ event_id: '11', name: 'Categorie 7 -  Heren Enkel', entries: 13, participants: [['me'], ...xs.map((id) => [id])] }],
      { players: [...NO_DRAWS_YET.players, ...xs.map((id, i) => ({ id, name: id, nationalRanking: singlesRank(i, 0.5) }))] },
    );
    await selectMe(big);
    const random = vi.spyOn(Math, 'random');
    const opponentsAfterClick = async (randomValue) => {
      random.mockReturnValue(randomValue);
      simulateTournamentMatch.mockClear();
      await clickMock();
      await waitFor(() => expect(simulateTournamentMatch).toHaveBeenCalled());
      await screen.findByText('Mocked draw');
      return simulateTournamentMatch.mock.calls.map(([, , , b]) => b).sort();
    };

    const first = await opponentsAfterClick(0.05);
    const second = await opponentsAfterClick(0.95);
    random.mockRestore();

    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(second.length).toBeGreaterThanOrEqual(3);
    expect(first).not.toEqual(second);
  });

  it('shows the no-national-data message for an unranked opponent', async () => {
    simulateTournamentMatch.mockResolvedValue({ error: true, message: 'Two, Opp has no national ranking data to simulate this match with.' });
    await selectMe();
    await clickMock();

    expect((await screen.findAllByText(/has no national ranking data/)).length).toBeGreaterThan(0);
  });

  it("explains when the player's own doubles entry has no partner yet", async () => {
    await selectMe(withEvents([{ event_id: '13', name: 'Categorie 7 -  Heren Dubbel', entries: 2, participants: [['me'], ['q1', 'q2']] }]));
    await clickMock();

    expect(await screen.findByText('Still waiting for a partner to be registered.')).toBeInTheDocument();
    expect(simulateTournamentMatch).not.toHaveBeenCalled();
  });

  it('says so when nobody else is registered in the event', async () => {
    await selectMe(withEvents([{ event_id: '11', name: 'Categorie 7 -  Heren Enkel', entries: 1, participants: [['me']] }]));
    await clickMock();

    expect(await screen.findByText('Nobody else is registered in this event yet.')).toBeInTheDocument();
  });

  it('shows no button when per-event entrants are not known', async () => {
    await selectMe(withEvents([{ event_id: '11', name: 'Categorie 7 -  Heren Enkel', entries: 4 }]));

    expect(await screen.findByText('No draw data available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });

  it('only mocks the events that still lack a published draw, next to the real ones', async () => {
    await selectMe(withEvents(NO_DRAWS_YET.events, {
      draws: [{ draw_id: 'd1', name: 'Categorie 7 - Heren Enkel', standings: [{ players: [{ player_id: 'me' }] }, { players: [{ player_id: 'o1' }] }] }],
    }));

    expect(await screen.findByText('No draw data available yet for Categorie 7 - Heren Dubbel')).toBeInTheDocument();
    await clickMock();
    await screen.findAllByText('Mocked draw');

    expect(screen.getAllByText('Mocked draw')).toHaveLength(1);
    expect(simulateTournamentMatch.mock.calls.filter(([, d]) => d === 'doubles')).toHaveLength(1);
  });

  it('simulates a published doubles draw as pair against pair', async () => {
    await selectMe(withEvents([], {
      draws: [{
        draw_id: 'd2',
        name: 'Categorie 7 - Heren Dubbel',
        standings: [{ players: [{ player_id: 'me' }, { player_id: 'pa' }] }, { players: [{ player_id: 'q1' }, { player_id: 'q2' }] }],
      }],
    }));

    await waitFor(() => expect(simulateTournamentMatch).toHaveBeenCalledWith('t1', 'doubles', ['me', 'pa'], ['q1', 'q2']));
    expect(await screen.findByText('Playing with Nguyen, Dung')).toBeInTheDocument();
  });

  it('clears the mocked results when another player is picked', async () => {
    await selectMe();
    await clickMock();
    await screen.findAllByText('Mocked draw');

    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Lone' } });
    fireEvent.mouseDown(await screen.findByText('Lone, Wolf'));

    await waitFor(() => expect(screen.queryByText('Mocked draw')).not.toBeInTheDocument());
  });

  it('shows the error when a mocked simulation fails', async () => {
    simulateTournamentMatch.mockRejectedValue(new Error('boom'));
    await selectMe();
    await clickMock();

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
