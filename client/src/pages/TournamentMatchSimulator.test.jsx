import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TournamentMatchSimulator from './TournamentMatchSimulator.jsx';

const fetchTournaments = vi.fn();
const simulateTournamentMatch = vi.fn();
const tournamentWinModel = vi.fn();
vi.mock('../api.js', () => ({
  fetchTournaments: (...args) => fetchTournaments(...args),
  simulateTournamentMatch: (...args) => simulateTournamentMatch(...args),
  tournamentWinModel: (...args) => tournamentWinModel(...args),
}));

// A simulated side as the API returns it: one member per player.
const rankedSide = (id, name, ranking = { rank: 42, points: 300 }, profile = null, url = null) => ({
  name,
  ranking,
  members: [{ id, name, ranking, profile, url }],
});

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
      type: 'Poule',
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
        sideB: rankedSide('p3', 'Cara Gamma'),
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

  it('leaves names as plain text when no profile is known', async () => {
    simulateTournamentMatch.mockResolvedValue({ sideB: rankedSide('p3', 'Cara Gamma'), winProbabilityA: 0.7, winProbabilityB: 0.3 });
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findAllByText(/vs Cara Gamma/)).not.toHaveLength(0);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the opponent line in one element so the flex layout does not trim its spaces', async () => {
    simulateTournamentMatch.mockResolvedValue({ sideB: rankedSide('p3', 'Cara Gamma'), winProbabilityA: 0.7, winProbabilityB: 0.3 });
    await selectTournamentAndPlayer('Alice Alpha');

    const [line] = await screen.findAllByText(/vs Cara Gamma/);
    expect(line.tagName).toBe('SPAN');
    expect(line.parentElement).toHaveClass('rating');
    expect(line.parentElement.children).toHaveLength(1);
    expect(line).toHaveTextContent('vs Cara Gamma \u2014 #42 (300 pts)');
  });
});

describe('TournamentMatchSimulator - player profiles', () => {
  const CARA = '615c2c92-eee8-494c-8ac8-9cf6b2deb0a8';
  const ALICE = '8d5d4da6-555d-461d-9713-eb531f630bcc';
  const total = {
    career: { wins: 97, losses: 60 },
    thisYear: { wins: 77, losses: 39 },
    form: [{ date: '2026-09-25', won: true }, { date: '2026-10-10', won: false }],
  };
  const singles = { career: { wins: 45, losses: 22 }, thisYear: { wins: 34, losses: 15 } };
  const caraProfile = { guid: CARA, stats: { total, singles } };
  const aliceProfile = { guid: ALICE, stats: { total, singles } };
  const profileUrl = (guid) => `https://badmintonnederland.toernooi.nl/player-profile/${guid}`;

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    const players = TOURNAMENT.players.map((p) => {
      if (p.id === 'p1') return { ...p, profile: aliceProfile, url: profileUrl(ALICE) };
      if (p.id === 'p3') return { ...p, profile: caraProfile, url: profileUrl(CARA) };
      return p;
    });
    fetchTournaments.mockResolvedValue([{ ...TOURNAMENT, players }]);
    simulateTournamentMatch.mockResolvedValue({
      discipline: 'singles',
      sideB: rankedSide('p3', 'Cara Gamma', { rank: 42, points: 300 }, caraProfile, profileUrl(CARA)),
      winProbabilityA: 0.7,
      winProbabilityB: 0.3,
    });
  });

  it('links an opponent to their profile and shows their record in the discipline', async () => {
    await selectTournamentAndPlayer('Alice Alpha');

    const [link] = await screen.findAllByRole('link', { name: 'Cara Gamma' });
    expect(link).toHaveAttribute('href', profileUrl(CARA));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getAllByText('Career 45–22 (67%) · This year 34–15 (69%)')).not.toHaveLength(0);
  });

  it('shows the selected player\'s statistics, recent form and a link to their profile', async () => {
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText('97–60 (62%)')).toBeInTheDocument();
    expect(screen.getByText('77–39 (66%)')).toBeInTheDocument();
    expect(screen.getByText('45–22 (67%)')).toBeInTheDocument();
    expect(screen.getByTitle('2026-09-25')).toHaveTextContent('W');
    expect(screen.getByTitle('2026-10-10')).toHaveTextContent('L');
    expect(screen.getByRole('link', { name: 'View profile on Badminton Nederland' })).toHaveAttribute('href', profileUrl(ALICE));
  });

  it('links the doubles partner and each member of an opposing pair', async () => {
    const players = [
      { id: 'me', name: 'Do, Quan', nationalRanking: { doubles: { rank: 3, points: 9 } } },
      { id: 'pa', name: 'Nguyen, Dung', nationalRanking: { doubles: { rank: 4, points: 8 } }, url: profileUrl('G-PARTNER') },
    ];
    const draw = { draw_id: 'dd', name: 'HD', type: 'Poule', standings: [{ players: [{ player_id: 'me' }, { player_id: 'pa' }] }, { players: [{ player_id: 'q1' }, { player_id: 'q2' }] }], matches: [] };
    const pair = [
      { id: 'q1', name: 'Q, One', ranking: { rank: 5 }, url: profileUrl('G-Q1'), profile: { guid: 'G-Q1', stats: { doubles: { career: { wins: 1, losses: 1 } } } } },
      { id: 'q2', name: 'Q, Two', ranking: { rank: 6 }, url: 'https://badmintonnederland.toernooi.nl/find/player?q=10002752', profile: null },
    ];
    fetchTournaments.mockResolvedValue([{ ...TOURNAMENT, players: [...players, { id: 'q1', name: 'Q, One' }, { id: 'q2', name: 'Q, Two' }], draws: [draw] }]);
    simulateTournamentMatch.mockResolvedValue({
      discipline: 'doubles',
      sideB: { name: 'Q, One / Q, Two', ranking: null, members: pair },
      winProbabilityA: 0.5,
      winProbabilityB: 0.5,
    });
    await selectTournamentAndPlayer('Do, Quan');

    expect(await screen.findByRole('link', { name: 'Nguyen, Dung' })).toHaveAttribute('href', profileUrl('G-PARTNER'));
    expect(screen.getByRole('link', { name: 'Q, One' })).toHaveAttribute('href', profileUrl('G-Q1'));
    expect(screen.getByRole('link', { name: 'Q, Two' })).toHaveAttribute('href', expect.stringContaining('/find/player?q=10002752'));
    expect(screen.getByText('Q, One: Career 1–1 (50%)')).toBeInTheDocument();
  });

  it('links the possible opponents in a knockout bracket', async () => {
    const names = { p1: 'Alice Alpha', p2: 'Bob Beta', p3: 'Cara Gamma', p4: 'Dana Delta' };
    tournamentWinModel.mockResolvedValue({
      isRated: () => true,
      winProbability: () => 0.6,
      nameOf: (id) => names[id] ?? id,
    });
    const side = (id) => ({ won: false, players: id ? [{ player_id: id }] : [] });
    const tie = (round, a, b) => ({ round, sides: [side(a), side(b)] });
    const bracket = [tie('Halve finale', 'p1', 'p3'), tie('Halve finale', 'p2', 'p4'), tie('Finale')];
    fetchTournaments.mockResolvedValue([{
      ...TOURNAMENT,
      players: TOURNAMENT.players.map((p) => (p.id === 'p3' ? { ...p, profile: caraProfile, url: profileUrl(CARA) } : p)),
      draws: [{ draw_id: 'k1', name: 'HE', type: 'Afvalschema', stage: 'Hoofdschema', matches: bracket }],
    }]);
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByRole('link', { name: 'Cara Gamma' })).toHaveAttribute('href', profileUrl(CARA));
    expect(screen.getByText('60% Bob Beta - you win 60%')).toBeInTheDocument();
  });
});

describe('TournamentMatchSimulator - upcoming tournaments', () => {
  // Far-future dates keep these upcoming whenever the tests run.
  const OTHER = { id: 't2', name: 'Winter Masters 2099', club: 'BC X', location: 'Breda', dates: ['2099-12-05 00:00', '2099-12-06 23:59'], players: [], draws: [] };
  const OLD = { id: 't3', name: 'Old Open', dates: ['2020-01-01 00:00'], players: [], draws: [] };
  const partner = { id: 'pa', name: 'Nguyen, Dung', url: 'https://badmintonnederland.toernooi.nl/player-profile/G-PARTNER' };
  const aliceEntries = [
    { id: 't1', events: [{ name: 'HE 1', partners: [] }] },
    { id: 't2', events: [{ name: 'HE 7', partners: [] }, { name: 'HD 7', partners: [partner] }] },
    { id: 't3', events: [{ name: 'HE 2', partners: [] }] },
  ];
  const caraEntries = [{ id: 't2', events: [{ name: 'HE 9', partners: [] }] }];

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    const players = TOURNAMENT.players.map((p) => {
      if (p.id === 'p1') return { ...p, tournaments: aliceEntries };
      if (p.id === 'p3') return { ...p, tournaments: caraEntries };
      return p;
    });
    fetchTournaments.mockResolvedValue([{ ...TOURNAMENT, dates: ['2099-11-01 00:00'], players }, OTHER, OLD]);
    simulateTournamentMatch.mockResolvedValue({
      discipline: 'singles',
      sideB: { ...rankedSide('p3', 'Cara Gamma'), members: [{ ...rankedSide('p3', 'Cara Gamma').members[0], tournaments: caraEntries }] },
      winProbabilityA: 0.7,
      winProbabilityB: 0.3,
    });
  });

  it('lists the selected player\'s upcoming tournaments with the events entered, and leaves out finished ones', async () => {
    await selectTournamentAndPlayer('Alice Alpha');

    const card = (await screen.findByText('Alice Alpha: upcoming tournaments')).closest('.upcoming');
    expect(within(card).getByRole('link', { name: 'Winter Masters 2099' })).toHaveAttribute('href', expect.stringContaining('/sport/tournament?id=t2'));
    const row = within(card).getByRole('link', { name: 'Winter Masters 2099' }).closest('tr');
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Winter Masters 2099', '5 Dec 2099 – 6 Dec 2099', 'Breda', 'HE 7HD 7 with Nguyen, Dung']);
    expect(within(row).getByRole('link', { name: 'Nguyen, Dung' })).toHaveAttribute('href', partner.url);
    expect(within(card).queryByText('Old Open')).not.toBeInTheDocument();
  });

  it('offers an opponent\'s upcoming tournaments collapsed beneath their line', async () => {
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findAllByText('Cara Gamma: upcoming tournaments (1)')).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Winter Masters 2099' }).length).toBeGreaterThan(1);
  });
});

describe('TournamentMatchSimulator - draws and persistence', () => {
  const STORAGE_KEY = 'badminton-app-tournament-state';
  const WIN_RESULT = {
    sideB: rankedSide('p3', 'Cara Gamma'),
    winProbabilityA: 0.7,
    winProbabilityB: 0.3,
  };
  const standings = (...ids) => ids.map((id) => ({ players: [{ player_id: id }] }));
  const withDraws = (draws) => fetchTournaments.mockResolvedValue([{ ...TOURNAMENT, draws: draws?.map((draw) => ({ type: 'Poule', ...draw })) }]);

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
        ? {
          name: 'Q, One / Q, Two',
          ranking: null,
          members: [{ id: 'q1', name: 'Q, One', ranking: { rank: 5 } }, { id: 'q2', name: 'Q, Two', ranking: { rank: 6 } }],
        }
        : rankedSide(b, `Opp ${b}`, { rank: 10, points: 90 }),
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
      draws: [{ draw_id: 'd1', type: 'Poule', name: 'Categorie 7 - Heren Enkel', standings: [{ players: [{ player_id: 'me' }] }, { players: [{ player_id: 'o1' }] }] }],
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
        type: 'Poule',
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

describe('TournamentMatchSimulator - draw formats', () => {
  const WIN_RESULT = { sideB: rankedSide('p3', 'Cara Gamma'), winProbabilityA: 0.7, winProbabilityB: 0.3 };
  const standings = (...ids) => ids.map((id) => ({ players: [{ player_id: id }] }));
  const side = (id) => ({ won: false, players: id ? [{ player_id: id }] : [] });
  const tie = (round, a, b) => ({ round, sides: [side(a), side(b)] });
  const BRACKET = [tie('Halve finale', 'p1', 'p3'), tie('Halve finale', 'p2', 'p4'), tie('Finale')];
  const withDraws = (draws) => fetchTournaments.mockResolvedValue([{ ...TOURNAMENT, draws }]);
  const names = { p1: 'Alice Alpha', p2: 'Bob Beta', p3: 'Cara Gamma', p4: 'Dana Delta' };
  const model = (unrated = []) => ({
    isRated: (team) => !team.some((id) => unrated.includes(id)),
    winProbability: (a, b) => (a.join() < b.join() ? 0.6 : 0.4),
    nameOf: (id) => names[id] ?? id,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    simulateTournamentMatch.mockResolvedValue(WIN_RESULT);
    tournamentWinModel.mockResolvedValue(model());
  });

  it('plays a knockout draw round by round instead of against everyone in it', async () => {
    withDraws([{ draw_id: 'k1', name: 'HE', type: 'Afvalschema', stage: 'Hoofdschema', matches: BRACKET }]);
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText('Halve finale')).toBeInTheDocument();
    expect(screen.getByText('Finale')).toBeInTheDocument();
    expect(screen.getByText('vs Cara Gamma - you win 60%')).toBeInTheDocument();
    expect(screen.getByText('60% Bob Beta - you win 60%')).toBeInTheDocument();
    expect(screen.getByText('40% Dana Delta - you win 60%')).toBeInTheDocument();
    expect(screen.getByText('Chance to win the draw: 36%')).toBeInTheDocument();
    expect(tournamentWinModel).toHaveBeenCalledWith('t1', 'singles');
    expect(simulateTournamentMatch).not.toHaveBeenCalled();
  });

  it('does not guess when someone later in the bracket has no ranking', async () => {
    tournamentWinModel.mockResolvedValue(model(['p2']));
    withDraws([{ draw_id: 'k1', name: 'HE', type: 'Afvalschema', stage: 'Hoofdschema', matches: BRACKET }]);
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText("Can't be simulated: Bob Beta has no national ranking data.")).toBeInTheDocument();
    expect(screen.getByText('vs Cara Gamma - you win 60%')).toBeInTheDocument();
    expect(screen.queryByText(/Chance to win the draw/)).not.toBeInTheDocument();
  });

  it('says so when a bracket cannot be worked out from the published draw', async () => {
    withDraws([{ draw_id: 'k1', name: 'HE', type: 'Afvalschema', matches: [tie('Finale', 'p1', undefined)] }]);
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText("This bracket can't be worked out from the published draw yet.")).toBeInTheDocument();
  });

  it('plays a home-and-away pool against each opponent twice, and says so', async () => {
    withDraws([{ draw_id: 'd1', name: 'HE', type: 'Poule - Thuis en Uit', standings: standings('p1', 'p3') }]);
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText('Home and away: each opponent is played twice.')).toBeInTheDocument();
    expect(simulateTournamentMatch).toHaveBeenCalledWith('t1', 'singles', 'p1', 'p3');
  });

  it('does not treat a format it does not know as a round robin', async () => {
    withDraws([{ draw_id: 'd1', name: 'HE', type: 'Zwitsers', standings: standings('p1', 'p3') }]);
    await selectTournamentAndPlayer('Alice Alpha');

    expect(await screen.findByText('The "Zwitsers" draw format is not supported by the simulator.')).toBeInTheDocument();
    expect(simulateTournamentMatch).not.toHaveBeenCalled();
  });

  describe('mocked draws', () => {
    const EVENT = { event_id: '11', name: 'Categorie 7 -  Heren Enkel', entries: 5, participants: [['p1'], ['p2'], ['p3'], ['p4'], ['p5']] };
    const tournament = (draws = []) => ({
      ...TOURNAMENT,
      players: [...TOURNAMENT.players, { id: 'p5', name: 'Eve Epsilon', club: 'Club E', nationalRanking: null }],
      events: [EVENT],
      draws,
    });
    const poolDraw = { draw_id: 'x', name: 'Other', type: 'Poule', stage: 'Hoofdschema', standings: standings('p9', 'p8') };
    const knockoutDraw = { draw_id: 'y', name: 'Other', type: 'Afvalschema', stage: 'Hoofdschema', matches: [] };
    const mockButton = { name: 'Simulate matches with mocked draws' };

    async function open(draws) {
      fetchTournaments.mockResolvedValue([tournament(draws)]);
      render(<TournamentMatchSimulator />);
      await pickTournament();
      const input = screen.getByPlaceholderText('Search player...');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Alice Alpha' } });
      fireEvent.mouseDown(await screen.findByText('Alice Alpha'));
    }

    it('defaults to pools, or to a bracket when the tournament published brackets', async () => {
      await open([poolDraw]);
      expect(await screen.findByLabelText('Mocked draw format')).toHaveValue('pools');
    });

    it('follows the tournament: brackets when its main draws are brackets', async () => {
      await open([knockoutDraw, { ...knockoutDraw, draw_id: 'z' }, poolDraw]);
      expect(await screen.findByLabelText('Mocked draw format')).toHaveValue('knockout');
    });

    it('ignores playoffs when working out the default', async () => {
      await open([poolDraw, { ...knockoutDraw, stage: 'Playoff' }, { ...knockoutDraw, draw_id: 'z', stage: 'Playoff' }]);
      expect(await screen.findByLabelText('Mocked draw format')).toHaveValue('pools');
    });

    it('deals a random bracket and plays it round by round when knockout is chosen', async () => {
      tournamentWinModel.mockResolvedValue(model(['p2']));
      await open([poolDraw]);
      fireEvent.change(await screen.findByLabelText('Mocked draw format'), { target: { value: 'knockout' } });
      fireEvent.click(screen.getByRole('button', mockButton));

      expect(await screen.findByText('Random knockout bracket for 5 players, 3 byes')).toBeInTheDocument();
      expect(screen.getByText('Mocked draw')).toBeInTheDocument();
      expect(screen.getAllByText(/Finale|Halve finale|Kwartfinale/).length).toBeGreaterThan(0);
      expect(simulateTournamentMatch).not.toHaveBeenCalled();
    });

    it('keeps the pool behaviour when pools are chosen, and clears results when the format changes', async () => {
      await open([knockoutDraw, { ...knockoutDraw, draw_id: 'z' }]);
      fireEvent.change(await screen.findByLabelText('Mocked draw format'), { target: { value: 'pools' } });
      fireEvent.click(screen.getByRole('button', mockButton));
      expect(await screen.findByText(/Random pool of/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Mocked draw format'), { target: { value: 'knockout' } });
      await waitFor(() => expect(screen.queryByText('Mocked draw')).not.toBeInTheDocument());
    });
  });
});
