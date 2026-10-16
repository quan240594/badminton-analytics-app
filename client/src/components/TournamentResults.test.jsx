import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TournamentResults from './TournamentResults.jsx';
import ProfileHeader from './ProfileHeader.jsx';

const side = (won, ...players) => ({ won, players: players.map((name, index) => ({ player_id: `${name}${index}`, name })) });
const match = (id, round, sides, ownIndex, games = [[21, 15], [18, 21], [21, 19]], playedAt = 'za 7-11-2026 16:00') => ({ match_id: id, round, sides, ownIndex, games, played_at: playedAt });
const tournament = { id: 'T1', name: 'Autumn Open', club: 'BC Alpha', location: 'Utrecht', dates: ['2026-11-07 00:00', '2026-11-08 23:59'] };

describe('TournamentResults', () => {
  it('shows each tournament with its draws and match cards', () => {
    const results = [{
      tournament,
      draws: [{ draw: { draw_id: 'd1', name: 'MD  6 - Groep A', stage: 'Hoofdschema' }, matches: [match('1', 'Ronde 1', [side(true, 'Ann', 'Bo'), side(false, 'Cy', 'Di')], 0)] }],
    }];
    render(<TournamentResults results={results} />);

    expect(screen.getByRole('heading', { name: 'Tournaments' })).toBeInTheDocument();
    expect(screen.getByText('7 Nov 2026 \u2013 8 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MD 6 - Groep A' })).toBeInTheDocument();
    expect(screen.getByText('Ann / Bo')).toBeInTheDocument();
    expect(screen.getByText('Cy / Di')).toBeInTheDocument();
    expect(screen.getByText('Sat, 7 Nov 2026')).toBeInTheDocument();
  });

  it('marks the profile\'s own side and result, and shows each side\'s game scores', () => {
    const lost = match('2', 'Finale', [side(true, 'Eve'), side(false, 'Fay')], 1);
    render(<TournamentResults results={[{ tournament, draws: [{ draw: { draw_id: 'd2', name: 'HE' }, matches: [lost] }] }]} />);

    const card = screen.getByText('Finale').closest('li');
    expect(within(card).getByText('(profile)').closest('.tn-match__row')).toHaveTextContent('Fay');
    expect(within(card).getByText('21 18 21')).toBeInTheDocument();
    expect(within(card).getByText('15 21 19')).toBeInTheDocument();
    expect(within(card).getByTitle('Lost')).toHaveTextContent('L');
    expect(within(card).getByText('Eve').closest('.tn-match__row')).toHaveClass('has-won');
  });

  it('copes with a tournament without club, place or dates, and a match without a date', () => {
    const bare = { id: 'T9', name: 'Bare Cup' };
    const undated = match('3', 'Ronde 2', [side(true, 'Gus'), side(false, 'Hal')], 0, [[21, 1]], null);
    render(<TournamentResults results={[{ tournament: bare, draws: [{ draw: { draw_id: 'd3', name: 'HE', type: 'Poule' }, matches: [undated] }] }]} />);

    expect(screen.getByRole('link', { name: 'Bare Cup' })).toBeInTheDocument();
    expect(screen.queryByText(/\|/)).not.toBeInTheDocument();
    expect(screen.getByText('Poule')).toBeInTheDocument();
  });

  it('says when there is nothing to show', () => {
    render(<TournamentResults results={[]} />);
    expect(screen.getByText('No played matches known yet.')).toBeInTheDocument();
  });
});

describe('ProfileHeader', () => {
  it('shows the name the toernooi way with the MemberID and country', () => {
    render(<ProfileHeader name="Hoang, Linh" memberId="50016928" country="NED" />);

    expect(screen.getByRole('heading', { name: 'Linh Hoang' })).toBeInTheDocument();
    expect(screen.getByText('(50016928)')).toBeInTheDocument();
    expect(screen.getByText('NED')).toBeInTheDocument();
  });

  it('leaves out what is unknown', () => {
    render(<ProfileHeader name="Pol, Pancho van de" />);

    expect(screen.getByRole('heading', { name: 'Pancho van de Pol' })).toBeInTheDocument();
    expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
  });
});
