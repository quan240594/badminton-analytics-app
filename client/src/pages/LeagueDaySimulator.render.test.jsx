import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import LeagueDaySimulator from './LeagueDaySimulator.jsx';
import { makePlayer, metaFixture, pickOption } from '../testFixtures.js';

const STORAGE_KEY = 'badminton-app-league-day-state';

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

const MENS_CODES = ['MD1', 'MD2', 'MS1', 'MS2', 'MS3', 'MS4', 'MD3', 'MD4'];
const AUTO_FILL_BUTTONS = [
  'Match players with closest ratings',
  'Match players for club A to get at least 5 wins',
  'Match players for club B to get at least 5 wins',
];

const playersFixture = [
  makePlayer('a1', 'Club A', 1700, { doublesRating: 1650 }),
  makePlayer('a2', 'Club A', 1600, { doublesRating: 1550 }),
  makePlayer('a3', 'Club A', 1500, { doublesRating: 1500 }),
  makePlayer('a4', 'Club A', 1400, { doublesRating: 1450 }),
  makePlayer('b1', 'Club B', 1690, { doublesRating: 1640 }),
  makePlayer('b2', 'Club B', 1590, { doublesRating: 1540 }),
  makePlayer('b3', 'Club B', 1490, { doublesRating: 1490 }),
  makePlayer('b4', 'Club B', 1390, { doublesRating: 1440 }),
];

// Rosters of 5+ men per club are too big for the fixed small-roster lineup, so autofill optimises.
const bigRoster = (club, prefix, count = 6) =>
  Array.from({ length: count }, (_, i) => makePlayer(`${prefix}${i + 1}`, club, 1700 - i * 60, { doublesRating: 1650 - i * 60 }));

function mixedRoster(club, prefix) {
  const men = Array.from({ length: 4 }, (_, i) => makePlayer(`${prefix}m${i + 1}`, club, 1700 - i * 80));
  const women = Array.from({ length: 3 }, (_, i) => makePlayer(`${prefix}w${i + 1}`, club, 1650 - i * 80));
  const genders = Object.fromEntries([...men.map((p) => [p.id, 'M']), ...women.map((p) => [p.id, 'F'])]);
  return { players: [...men, ...women], genders };
}

function slotsFor(codes, filled = {}) {
  return codes.map((code) => {
    const size = code.startsWith('MS') || code.startsWith('WS') ? 1 : 2;
    const blank = () => Array(size).fill('');
    return { code, sideA: filled[code]?.[0] ?? blank(), sideB: filled[code]?.[1] ?? blank() };
  });
}

function storeState(overrides = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    division: 'Mannen Veer 2', drawId: '12', clubFilterA: '', teamFilterA: null, clubFilterB: '', teamFilterB: null,
    slots: slotsFor(MENS_CODES), ...overrides,
  }));
}

async function renderPage() {
  await act(async () => {
    render(<LeagueDaySimulator />);
  });
}

const clubInput = (side) => screen.getAllByPlaceholderText('Club filter')[side === 'A' ? 0 : 1];
const chooseClubs = (clubA, clubB) => {
  pickOption(clubInput('A'), clubA);
  pickOption(clubInput('B'), clubB);
};
const rubberRow = (code) => screen.getByText(code).closest('.rubber-row');
const rubberInputs = (code) => within(rubberRow(code)).getAllByPlaceholderText('Search player...');
const clickAutoFill = (name) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  isAdminRef.current = true;
  api.fetchPlayers.mockResolvedValue(playersFixture);
  api.fetchMeta.mockResolvedValue(metaFixture());
  api.simulateMatch.mockResolvedValue({ winProbabilityA: 0.6, winProbabilityB: 0.4, headToHead: null });
});

describe('LeagueDaySimulator - setup', () => {
  it('loads players/meta and renders the division and pool selects', async () => {
    await renderPage();

    expect(screen.getByText(/8 rated players/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Division/ })).toHaveValue('Mannen Veer 2');
    expect(screen.getByText('Afd. 12')).toBeInTheDocument();
  });

  it('surfaces the error message when the initial players fetch fails', async () => {
    api.fetchPlayers.mockRejectedValue(new Error('network down'));
    render(<LeagueDaySimulator />);
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });

  it.each([
    ['rejects', () => api.fetchMeta.mockRejectedValue(new Error('no meta'))],
    ['has none of the optional fields', () => api.fetchMeta.mockResolvedValue({})],
  ])('still renders when the meta fetch %s', async (_case, arrange) => {
    arrange();
    await renderPage();

    expect(screen.getByRole('combobox', { name: /Pool/ })).toBeDisabled();
  });

  it('restores the saved division, pool, club filters and lineup', async () => {
    storeState({
      drawId: '13', clubFilterA: 'Club A', teamFilterA: 'M2',
      slots: slotsFor(MENS_CODES, { MS1: [['a1'], ['b1']] }),
    });
    await renderPage();

    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('13');
    expect(clubInput('A')).toHaveValue('Club A');
    expect(screen.getByRole('combobox', { name: '' })).toBeInTheDocument();
    await waitFor(() => expect(api.simulateMatch).toHaveBeenCalledWith('singles', ['a1'], ['b1']));
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a saved state without slots', JSON.stringify({ division: 'Mannen Veer 3' })],
  ])('ignores %s in storage', async (_case, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    await renderPage();

    expect(screen.getByRole('combobox', { name: /Division/ })).toHaveValue('Mannen Veer 2');
    expect(screen.getByText('Fill in players to see the projected result.')).toBeInTheDocument();
  });

  it('switching pool resets the lineup and club filters', async () => {
    await renderPage();
    chooseClubs('Club A', 'Club B');

    fireEvent.change(screen.getByRole('combobox', { name: /Pool/ }), { target: { value: '13' } });

    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('13');
    expect(clubInput('A')).toHaveValue('');
    expect(clubInput('B')).toHaveValue('');
  });

  it('switching to another division picks its first pool', async () => {
    await renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Mannen Veer 3' } });

    expect(screen.getByRole('combobox', { name: /Division/ })).toHaveValue('Mannen Veer 3');
    expect(screen.getByRole('combobox', { name: /Pool/ })).toHaveValue('20');
  });

  it('switching to a division with no pools disables the pool select', async () => {
    await renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Mannen Nylon 1' } });

    expect(screen.getByRole('combobox', { name: /Pool/ })).toBeDisabled();
  });

  it('uses the mixed rubber list for non-veteran divisions', async () => {
    await renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Eredivisie' } });

    expect(['MD', 'WD', 'XD1', 'XD2'].every((code) => screen.queryByText(code))).toBe(true);
  });

  it('lets the user pick a team when a club has several squads and auto-selects when it has one', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: /Pool/ }), { target: { value: '13' } });

    pickOption(clubInput('A'), 'Club A');
    const teamSelect = screen.getByRole('combobox', { name: '' });
    expect(teamSelect).toHaveValue('');
    fireEvent.change(teamSelect, { target: { value: 'M2' } });
    expect(teamSelect).toHaveValue('M2');

    pickOption(clubInput('B'), 'Club B');
    expect(screen.getByText('M1', { selector: '.team-label' })).toBeInTheDocument();
  });

  it('clears the lineup and results with Clear all', async () => {
    await renderPage();
    chooseClubs('Club A', 'Club B');
    clickAutoFill(AUTO_FILL_BUTTONS[0]);
    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getByText('Fill in players to see the projected result.')).toBeInTheDocument();
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted.slots.every((s) => [...s.sideA, ...s.sideB].every((id) => id === ''))).toBe(true);
  });
});

describe('LeagueDaySimulator - pool fetch', () => {
  beforeEach(() => {
    api.fetchMeta.mockResolvedValue(metaFixture({ fetchedDrawIds: [] }));
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress.mockResolvedValue({ running: false, percent: 100, error: null });
  });

  it.each([
    ['all meta fields', { players: playersFixture.slice(0, 2), meta: metaFixture({ fetchedDrawIds: ['12'] }) }, 'No data cached yet for this pool.', false],
    ['no meta fields', { players: playersFixture.slice(0, 2), meta: {} }, 'No data cached yet for this pool.', true],
  ])('applies the reloaded bundle with %s', async (_case, bundle, banner, bannerStays) => {
    api.reloadBundle.mockResolvedValue(bundle);
    await renderPage();
    expect(screen.getByText(banner)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fetch pool data' }));

    await waitFor(() => expect(screen.getByText(/2 rated players/)).toBeInTheDocument());
    expect(api.triggerPoolRefresh).toHaveBeenCalledWith('12');
    expect(Boolean(screen.queryByText(banner))).toBe(bannerStays);
  });

  it('shows a non-admin fallback message instead of the fetch button', async () => {
    isAdminRef.current = false;
    await renderPage();

    expect(screen.getByText('Ask an admin to fetch it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch pool data' })).not.toBeInTheDocument();
  });
});

describe('LeagueDaySimulator - rubbers', () => {
  it('simulates a rubber once both sides are picked and shows the win bar', async () => {
    await renderPage();
    chooseClubs('Club A', 'Club B');

    pickOption(rubberInputs('MS1')[0], 'a1');
    pickOption(rubberInputs('MS1')[1], 'b1');

    await waitFor(() => expect(api.simulateMatch).toHaveBeenCalledWith('singles', ['a1'], ['b1']));
    expect(await within(rubberRow('MS1')).findByText('60%')).toBeInTheDocument();
    expect(within(rubberRow('MS2')).getByText('Fill in both sides to see the projected result')).toBeInTheDocument();
  });

  it.each([
    [0.6, '60%', '40%'],
    [0.05, '', '95%'],
    [0.95, '95%', ''],
  ])('labels the rubber bar only when a side is wide enough (win probability %s)', async (probA, labelA, labelB) => {
    api.simulateMatch.mockResolvedValue({ winProbabilityA: probA, winProbabilityB: 1 - probA, headToHead: null });
    await renderPage();
    chooseClubs('Club A', 'Club B');

    pickOption(rubberInputs('MS1')[0], 'a1');
    pickOption(rubberInputs('MS1')[1], 'b1');

    await waitFor(() => expect(rubberRow('MS1').querySelector('.bar-a')).not.toBeNull());
    expect(rubberRow('MS1').querySelector('.bar-a')).toHaveTextContent(labelA, { normalizeWhitespace: true });
    expect(rubberRow('MS1').querySelector('.bar-b').textContent).toBe(labelB);
  });

  it('leaves a rubber out of the summary when its simulation fails', async () => {
    api.simulateMatch.mockRejectedValue(new Error('same player on both sides'));
    await renderPage();
    chooseClubs('Club A', 'Club B');

    pickOption(rubberInputs('MS1')[0], 'a1');
    pickOption(rubberInputs('MS1')[1], 'b1');

    await waitFor(() => expect(api.simulateMatch).toHaveBeenCalled());
    expect(await screen.findByText('Fill in players to see the projected result.')).toBeInTheDocument();
  });

  it.each([['a known player', 'a1', 'a1'], ['an unknown id', 'ghost', 'ghost']])(
    'warns when %s is in more than 3 rubbers',
    async (_case, id, name) => {
      storeState({
        slots: slotsFor(MENS_CODES, {
          MD1: [[id, 'a2'], ['b1', 'b2']], MD2: [[id, 'a3'], ['b3', 'b4']], MS1: [[id], ['b1']], MS2: [[id], ['b2']],
        }),
      });
      await renderPage();

      expect(screen.getByText(new RegExp(`${name} is in 4 rubbers`))).toBeInTheDocument();
    }
  );

  it('badges substitutes in the player pickers', async () => {
    api.fetchMeta.mockResolvedValue(metaFixture({ substitutePlayerIds: ['a2'] }));
    await renderPage();
    chooseClubs('Club A', 'Club B');

    pickOption(rubberInputs('MS1')[0], 'a2');
    pickOption(rubberInputs('MS2')[0], 'a1');

    expect(rubberRow('MS1').querySelector('.sub-badge')).toHaveStyle({ visibility: 'visible' });
    expect(rubberRow('MS2').querySelector('.sub-badge')).toHaveStyle({ visibility: 'hidden' });
  });

  it('only offers the pool roster when one is known', async () => {
    api.fetchMeta.mockResolvedValue(metaFixture({ poolRosters: { 12: ['a1', 'b1'] } }));
    await renderPage();
    chooseClubs('Club A', 'Club B');

    fireEvent.focus(rubberInputs('MS1')[0]);

    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['a1 Club A']);
  });

  it('drops a selected player who no longer matches a newly chosen club filter', async () => {
    await renderPage();
    chooseClubs('Club A', 'Club B');
    pickOption(rubberInputs('MS1')[0], 'a1');

    pickOption(clubInput('A'), 'Club B');
    expect(rubberInputs('MS1')[0]).toHaveValue('');

    pickOption(rubberInputs('MS1')[0], 'b1');
    pickOption(clubInput('A'), 'All clubs');
    expect(rubberInputs('MS1')[0]).toHaveValue('b1');
  });
});

describe('LeagueDaySimulator - filters and highlights', () => {
  it.each(['No player plays more than 3 matches', 'Top singles player starts fresh', 'Include substitutes'])(
    'toggles the "%s" option',
    async (label) => {
      await renderPage();
      const checkbox = screen.getByLabelText(label);

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    }
  );

  it('hides substitutes from the team highlights until they are included', async () => {
    const players = [...bigRoster('Club A', 'a'), ...bigRoster('Club B', 'b')];
    api.fetchPlayers.mockResolvedValue(players);
    api.fetchMeta.mockResolvedValue(metaFixture({
      substitutePlayerIds: ['a1'],
      playerGenders: Object.fromEntries(players.map((p) => [p.id, 'M'])),
    }));
    await renderPage();
    chooseClubs('Club A', 'Club B');
    const highestMsA = () => within(screen.getAllByText('Highest MS player')[0].closest('.team-highlights-row')).getByText(/^a\d$/);

    expect(highestMsA()).toHaveTextContent('a2');
    fireEvent.click(screen.getByLabelText('Include substitutes'));
    expect(highestMsA()).toHaveTextContent('a1');
  });

  it('ranks nationally-ranked players ahead of unranked ones and shows ranking points', async () => {
    const ranking = (rank, points) => ({ rank, points });
    const roster = mixedRoster('Club A', 'a');
    const rankedPlayers = roster.players.map((p) => {
      if (p.id === 'am1') return { ...p, nationalRanking: { singles: ranking(5, 900), doubles: ranking(9, 700), mixed: ranking(4, 650) } };
      if (p.id === 'am2') return { ...p, nationalRanking: { singles: ranking(3, 1000), doubles: ranking(2, 800), mixed: null } };
      return p;
    });
    api.fetchPlayers.mockResolvedValue([...rankedPlayers, makePlayer('b1', 'Club B', 1500)]);
    api.fetchMeta.mockResolvedValue(metaFixture({ playerGenders: roster.genders }));
    await renderPage();
    chooseClubs('Club A', 'Club B');

    const rowText = (label, idx = 0) => screen.getAllByText(label)[idx].closest('.team-highlights-row').textContent;
    expect(rowText('Highest MS player')).toContain('am2');
    expect(rowText('Highest MS player')).toContain('1000');
    expect(rowText('Highest MD players')).toContain('am2 / am1');
    expect(rowText('Highest WS player')).toContain('aw1');
    expect(rowText('Highest MS player', 1)).toContain('-');
  });
});

describe('LeagueDaySimulator - auto-fill', () => {
  const setupBigRosters = async () => {
    api.fetchPlayers.mockResolvedValue([...bigRoster('Club A', 'a'), ...bigRoster('Club B', 'b')]);
    await renderPage();
    chooseClubs('Club A', 'Club B');
  };

  it.each(AUTO_FILL_BUTTONS.flatMap((name) => [[name, false], [name, true]]))(
    'fills all 8 rubbers from large rosters with "%s" (top singles protected: %s)',
    async (name, protectTop) => {
      await setupBigRosters();
      if (protectTop) fireEvent.click(screen.getByLabelText('Top singles player starts fresh'));

      clickAutoFill(name);

      await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
      expect(screen.queryByText(/Could not fill/)).not.toBeInTheDocument();
    }
  );

  it('keeps hand-entered rubbers when optimising "closest ratings"', async () => {
    await setupBigRosters();
    pickOption(rubberInputs('MS1')[0], 'a6');
    pickOption(rubberInputs('MS1')[1], 'b6');

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
    expect(rubberInputs('MS1')[0]).toHaveValue('a6');
    expect(rubberInputs('MS1')[1]).toHaveValue('b6');
  });

  it('fills a mixed-doubles night respecting each rubber\'s gender', async () => {
    const clubA = mixedRoster('Club A', 'a');
    const clubB = mixedRoster('Club B', 'b');
    api.fetchPlayers.mockResolvedValue([...clubA.players, ...clubB.players]);
    api.fetchMeta.mockResolvedValue(metaFixture({ playerGenders: { ...clubA.genders, ...clubB.genders } }));
    await renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: 'Eredivisie' } });
    chooseClubs('Club A', 'Club B');
    fireEvent.click(screen.getByLabelText('Top singles player starts fresh'));

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
    expect(rubberInputs('WS1')[0].value).toMatch(/^aw/);
    expect(rubberInputs('MS1')[1].value).toMatch(/^bm/);
  });

  it('protects the top singles player of a small roster and still fills every rubber', async () => {
    await renderPage();
    chooseClubs('Club A', 'Club B');
    fireEvent.click(screen.getByLabelText('Top singles player starts fresh'));

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
  });

  it('can use substitutes once they are included', async () => {
    api.fetchPlayers.mockResolvedValue([...bigRoster('Club A', 'a'), ...bigRoster('Club B', 'b')]);
    api.fetchMeta.mockResolvedValue(metaFixture({ substitutePlayerIds: ['a1', 'a2'] }));
    await renderPage();
    chooseClubs('Club A', 'Club B');
    fireEvent.click(screen.getByLabelText('Include substitutes'));

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
  });

  it('warns about rubbers it cannot fill when a club has too few players', async () => {
    api.fetchPlayers.mockResolvedValue([makePlayer('a1', 'Club A', 1700), ...bigRoster('Club B', 'b')]);
    await renderPage();
    chooseClubs('Club A', 'Club B');

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    expect(await screen.findByText(/Could not fill: .* not enough eligible players for these rubbers\./)).toBeInTheDocument();
  });

  it('uses singular wording when only one rubber cannot be filled', async () => {
    const filled = Object.fromEntries(MENS_CODES.filter((c) => c !== 'MD4').map((code) => {
      const side = (id) => (code.startsWith('MS') ? [id] : [id, id]);
      return [code, [side('a1'), side('b1')]];
    }));
    filled.MD4 = [['', ''], ['b1', 'b2']];
    api.fetchPlayers.mockResolvedValue([makePlayer('a1', 'Club A', 1700), ...bigRoster('Club B', 'b')]);
    storeState({ clubFilterA: 'Club A', clubFilterB: 'Club B', slots: slotsFor(MENS_CODES, filled) });
    await renderPage();

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    expect(await screen.findByText(/Could not fill: MD4 — not enough eligible players for this rubber\./)).toBeInTheDocument();
  });
});

describe('LeagueDaySimulator - night summary', () => {
  it.each([
    [0.6, '59%', '23%'],
    [0.99, '100%', ''],
    [0.01, '', ''],
  ])('labels the night bar segments only when wide enough (rubber win probability %s)', async (probA, winLabelA, tieLabel) => {
    api.simulateMatch.mockResolvedValue({ winProbabilityA: probA, winProbabilityB: 1 - probA, headToHead: null });
    await renderPage();
    chooseClubs('Club A', 'Club B');

    clickAutoFill(AUTO_FILL_BUTTONS[0]);

    await waitFor(() => expect(screen.getByText(/8\/8 rubbers set/)).toBeInTheDocument());
    expect(document.querySelector('.night-bar .bar-a').textContent).toBe(winLabelA);
    expect(document.querySelector('.night-bar .bar-tie').textContent).toBe(tieLabel);
  });

  it('refreshes the players when the data refresh finishes', async () => {
    await renderPage();

    act(() => useDataRefreshState.onRefreshed({ players: playersFixture.slice(0, 3) }));

    expect(screen.getByText(/3 rated players/)).toBeInTheDocument();
  });
});
