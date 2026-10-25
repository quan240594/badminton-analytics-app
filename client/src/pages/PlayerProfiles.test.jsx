import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PlayerProfiles from './PlayerProfiles.jsx';

const fetchTournaments = vi.fn();
const fetchNationalPlayers = vi.fn();
vi.mock('../api.js', () => ({
  fetchTournaments: (...args) => fetchTournaments(...args),
  fetchNationalPlayers: (...args) => fetchNationalPlayers(...args),
}));

const STORAGE_KEY = 'badminton-app-profile-state';
const PROFILE_URL = 'https://badmintonnederland.toernooi.nl/player-profile/G-LINH';
const stats = {
  total: { career: { wins: 3, losses: 1 }, thisYear: { wins: 2, losses: 0 }, form: [{ date: '2026-09-25', won: true }] },
  singles: { career: { wins: 2, losses: 1 }, thisYear: { wins: 2, losses: 0 } },
};
const ranking = { singles: { rank: 611, points: 1289, topPoints: 2000, topName: 'Top Player', pctOfTop: 0.64 }, doubles: null, mixed: null };
const playedMatch = {
  match_id: 'm1',
  round: 'Ronde 1',
  sides: [{ won: true, players: [{ player_id: 'a', name: 'Linh Hoang' }] }, { won: false, players: [{ player_id: 'b', name: 'Opp One' }] }],
  games: [[21, 15], [21, 18]],
  played_at: 'za 7-11-2026 16:00',
};

const TOURNAMENTS = [
  {
    id: 'T1',
    name: 'Autumn Open',
    club: 'BC Alpha',
    location: 'Utrecht',
    dates: ['2099-10-01 00:00'],
    events: [],
    draws: [{ draw_id: 'd1', name: 'HE  1', type: 'Poule', stage: 'Hoofdschema', standings: [], matches: [playedMatch] }],
    players: [
      { id: 'a', name: 'Hoang, Linh', url: PROFILE_URL, memberId: '50016928', country: 'NED', profile: { guid: 'G-LINH', stats }, nationalRanking: ranking, tournaments: [{ id: 'T2', events: [{ name: 'HE 7', partners: [] }] }] },
      { id: 'b', name: 'Opp, One', url: 'https://badmintonnederland.toernooi.nl/find/player?q=999', memberId: '999', profile: null, nationalRanking: null, tournaments: [] },
    ],
  },
  {
    id: 'T2',
    name: 'Winter Cup',
    location: 'Breda',
    dates: ['2099-12-05 00:00'],
    events: [],
    draws: [],
    players: [{ id: 'z', name: 'Hoang, Linh', url: PROFILE_URL, memberId: '50016928', profile: { guid: 'G-LINH', stats }, nationalRanking: ranking, tournaments: [] }],
  },
];

// A player as national.json has them: only a MemberID and a ranking.
const national = (memberId, name, rank, points) => ({
  id: memberId,
  name,
  memberId,
  url: `https://badmintonnederland.toernooi.nl/find/player?q=${memberId}`,
  nationalRanking: { singles: { rank, points, topPoints: points, topName: name, pctOfTop: 1 }, doubles: null, mixed: null },
});

async function choose(name) {
  const input = screen.getByPlaceholderText('Search player...');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.mouseDown(await screen.findByText(name));
}

describe('PlayerProfiles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    fetchTournaments.mockResolvedValue(TOURNAMENTS);
    fetchNationalPlayers.mockResolvedValue([]);
  });

  it('shows the title and nothing about a player until one is chosen', async () => {
    render(<PlayerProfiles />);

    expect(screen.getByRole('heading', { name: 'Player profiles' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tournaments' })).not.toBeInTheDocument();
  });

  it('lists a person once, however many tournaments they are in', async () => {
    render(<PlayerProfiles />);
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'hoang' } });

    expect(await screen.findAllByText('Linh Hoang')).toHaveLength(1);
  });

  it('shows the header, the first details and the tournament results for the chosen player', async () => {
    render(<PlayerProfiles />);
    await choose('Linh Hoang');

    expect(screen.getByRole('heading', { name: 'Linh Hoang' })).toBeInTheDocument();
    expect(screen.getByText('(50016928)')).toBeInTheDocument();
    expect(screen.getByText('#611')).toBeInTheDocument();
    expect(screen.getByText('3\u20131 (75%)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile on Badminton Nederland' })).toHaveAttribute('href', PROFILE_URL);
    expect(screen.getByText('Hoang, Linh: upcoming tournaments')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Winter Cup' })).toBeInTheDocument();

    const results = screen.getByRole('heading', { name: 'Tournaments' }).closest('section');
    expect(within(results).getByRole('link', { name: 'Autumn Open' })).toHaveAttribute('href', expect.stringContaining('/sport/tournament?id=T1'));
    expect(within(results).getByText('BC Alpha | Utrecht')).toBeInTheDocument();
    expect(within(results).getByText('Ronde 1')).toBeInTheDocument();
    expect(within(results).getByText('21 21')).toBeInTheDocument();
    expect(within(results).getByTitle('Won')).toHaveTextContent('W');
  });

  it('says so when the player has no played matches', async () => {
    fetchTournaments.mockResolvedValue([{ ...TOURNAMENTS[1] }]);
    render(<PlayerProfiles />);
    await choose('Linh Hoang');

    expect(await screen.findByText('No played matches known yet.')).toBeInTheDocument();
  });

  it('finds someone who is only on the national ranking lists and shows their ranking', async () => {
    fetchNationalPlayers.mockResolvedValue([national('876236', 'Noah Haase', 1, 17492)]);
    render(<PlayerProfiles />);
    await choose('Noah Haase');

    expect(screen.getByRole('heading', { name: 'Noah Haase' })).toBeInTheDocument();
    expect(screen.getByText('(876236)')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile on Badminton Nederland' })).toHaveAttribute('href', expect.stringContaining('/find/player?q=876236'));
    expect(screen.getByText('No played matches known yet.')).toBeInTheDocument();
  });

  it('lists an entrant once when they are also on the national lists, and borrows the ranking they lack', async () => {
    fetchNationalPlayers.mockResolvedValue([national('999', 'One Opp', 7, 500)]);
    render(<PlayerProfiles />);
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'opp' } });
    expect(await screen.findAllByText('One Opp')).toHaveLength(1);
    fireEvent.mouseDown(screen.getByText('One Opp'));

    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('still works when the national lists cannot be loaded', async () => {
    fetchNationalPlayers.mockRejectedValue(new Error('offline'));
    render(<PlayerProfiles />);
    await choose('Linh Hoang');

    expect(screen.getByRole('heading', { name: 'Linh Hoang' })).toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });

  it('shows a limited number of matches and says how many more there are', async () => {
    fetchNationalPlayers.mockResolvedValue(Array.from({ length: 60 }, (_, i) => national(`${1000 + i}`, `Player ${String(i).padStart(2, '0')}`, i + 1, 100)));
    render(<PlayerProfiles />);
    const input = screen.getByPlaceholderText('Search player...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'player' } });

    expect(await screen.findAllByRole('option')).toHaveLength(50);
    expect(screen.getByText('10 more - keep typing to narrow down')).toBeInTheDocument();
  });

  it('restores the saved player and forgets them on Clear all', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedId: PROFILE_URL }));
    render(<PlayerProfiles />);

    expect(await screen.findByRole('heading', { name: 'Linh Hoang' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByRole('heading', { name: 'Linh Hoang' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).selectedId).toBe('');
  });

  it('ignores corrupt saved state', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    render(<PlayerProfiles />);

    expect(screen.getByRole('heading', { name: 'Player profiles' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Linh Hoang' })).not.toBeInTheDocument();
  });

  it('shows the error when the data cannot be loaded', async () => {
    fetchTournaments.mockRejectedValue(new Error('boom'));
    render(<PlayerProfiles />);

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
