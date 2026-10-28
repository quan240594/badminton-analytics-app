import { describe, it, expect } from 'vitest';
import { buildProfiles, displayName, parsePlayedAt, tournamentResults } from './profiles.js';

const ranking = (rank) => ({ singles: { rank, points: 100 }, doubles: null, mixed: null });

describe('displayName', () => {
  it('puts the first name (and infix) in front of the family name', () => {
    expect(displayName('Hoang, Linh')).toBe('Linh Hoang');
    expect(displayName('Pol, Pancho van de')).toBe('Pancho van de Pol');
  });

  it('leaves a name without a comma, and an empty one, alone', () => {
    expect(displayName('Madonna')).toBe('Madonna');
    expect(displayName(undefined)).toBe('');
  });
});

describe('buildProfiles', () => {
  const t1 = {
    id: 'T1',
    players: [
      { id: 'a', name: 'Hoang, Linh', url: 'U-LINH', country: null, memberId: null, profile: null, nationalRanking: null, tournaments: [{ id: 'T1', events: [] }] },
      { id: 'b', name: 'Other, Person', url: 'U-T1-b', nationalRanking: ranking(9), tournaments: [] },
    ],
  };
  const t2 = {
    id: 'T2',
    players: [
      { id: 'x', name: 'Hoang, Linh', url: 'U-LINH', country: 'NED', memberId: '50016928', profile: { guid: 'G', stats: {} }, nationalRanking: ranking(611), tournaments: [{ id: 'T1', events: [] }] },
      { id: 'y', name: 'Other, Person', url: 'U-T2-y', tournaments: [] },
      { id: 'z', name: 'No Link', tournaments: [] },
    ],
  };

  it('merges the same person across tournaments by their link and fills gaps from later entries', () => {
    const profiles = buildProfiles([t1, t2]);
    const linh = profiles.find((p) => p.url === 'U-LINH');
    expect(linh.appearances).toEqual([{ tournamentId: 'T1', playerId: 'a' }, { tournamentId: 'T2', playerId: 'x' }]);
    expect(linh).toMatchObject({ country: 'NED', memberId: '50016928', profile: { guid: 'G', stats: {} } });
    expect(linh.nationalRanking.singles.rank).toBe(611);
  });

  it('keeps people the site could not resolve apart, and skips entries without a link', () => {
    const profiles = buildProfiles([t1, t2]);
    expect(profiles.map((p) => p.url)).toEqual(['U-LINH', 'U-T1-b', 'U-T2-y']);
  });

  it('sorts by name', () => {
    expect(buildProfiles([t1, t2]).map((p) => p.name)).toEqual(['Hoang, Linh', 'Other, Person', 'Other, Person']);
  });

  it('keeps a ranking it already has', () => {
    const first = { id: 'T', players: [{ id: 'a', name: 'A', url: 'U', nationalRanking: ranking(5) }] };
    const second = { id: 'U', players: [{ id: 'b', name: 'A', url: 'U', nationalRanking: ranking(1) }] };
    expect(buildProfiles([first, second])[0].nationalRanking.singles.rank).toBe(5);
  });

  describe('with the national ranking lists', () => {
    const nationalPlayer = (memberId, name, rank) => ({ id: memberId, name, memberId, url: `N-${memberId}`, nationalRanking: ranking(rank) });

    it('adds people who are only on the lists, with just their ranking', () => {
      const profiles = buildProfiles([t1, t2], [nationalPlayer('876236', 'Noah Haase', 1)]);
      const noah = profiles.find((p) => p.memberId === '876236');
      expect(noah).toEqual({
        id: 'N-876236', name: 'Noah Haase', country: null, memberId: '876236', url: 'N-876236',
        profile: null, nationalRanking: ranking(1), tournaments: [], appearances: [],
      });
    });

    it('joins an entrant to their list entry by MemberID, keeping the entrant profile and one row', () => {
      const profiles = buildProfiles([t1, t2], [nationalPlayer('50016928', 'Linh Hoang', 3)]);
      expect(profiles.filter((p) => p.memberId === '50016928')).toHaveLength(1);
      const linh = profiles.find((p) => p.memberId === '50016928');
      expect(linh.url).toBe('U-LINH');
      expect(linh.nationalRanking.singles.rank).toBe(611); // already had one
    });

    it('gives an entrant the list ranking they lack', () => {
      const entrant = { id: 'T', players: [{ id: 'a', name: 'Opp, One', url: 'U-OPP', memberId: '999', nationalRanking: null, tournaments: [] }] };
      const [opp] = buildProfiles([entrant], [nationalPlayer('999', 'One Opp', 7)]);
      expect(opp.nationalRanking.singles.rank).toBe(7);
    });

    it('never joins on a name', () => {
      const entrant = { id: 'T', players: [{ id: 'a', name: 'Haase, Noah', url: 'U-NOAH', memberId: null, tournaments: [] }] };
      expect(buildProfiles([entrant], [nationalPlayer('876236', 'Noah Haase', 1)])).toHaveLength(2);
    });

    it('sorts everyone by the name as shown, first name first', () => {
      const names = buildProfiles([t1], [nationalPlayer('1', 'Zed Zero', 1), nationalPlayer('2', 'Anna Able', 2)]).map((p) => displayName(p.name));
      expect(names).toEqual(['Anna Able', 'Linh Hoang', 'Person Other', 'Zed Zero']);
    });
  });
});

describe('parsePlayedAt', () => {
  it('reads the date of a played-at text', () => {
    expect(parsePlayedAt('za 5-9-2026 16:00')).toEqual(new Date(2026, 8, 5));
    expect(parsePlayedAt('zo 21-6-2026')).toEqual(new Date(2026, 5, 21));
  });

  it('is null without a date', () => {
    expect(parsePlayedAt(null)).toBeNull();
    expect(parsePlayedAt('later')).toBeNull();
  });
});

describe('tournamentResults', () => {
  const side = (won, ...ids) => ({ won, players: ids.map((id) => ({ player_id: id, name: `P${id}` })) });
  const played = (id, round, a, b, games = [[21, 15], [21, 18]]) => ({ match_id: id, round, sides: [a, b], games, played_at: 'za 5-9-2026 16:00' });
  const tournament = (id, dates, draws) => ({ id, name: id, dates, draws });
  const profile = { appearances: [{ tournamentId: 'OLD', playerId: '7' }, { tournamentId: 'NEW', playerId: '8' }, { tournamentId: 'NONE', playerId: '9' }, { tournamentId: 'GONE', playerId: '1' }] };

  const tournaments = [
    tournament('OLD', ['2026-03-01 00:00'], [{ name: 'HE A', matches: [played('1', 'Ronde 1', side(true, '7'), side(false, '2'))] }]),
    tournament('NEW', ['2026-09-05 00:00'], [
      { name: 'MD B', matches: [played('2', 'Finale', side(false, '1', '3'), side(true, '8', '4')), played('3', 'Ronde 1', side(true, '5'), side(false, '6'))] },
      { name: 'unplayed', matches: [played('4', 'Ronde 2', side(false, '8'), side(false, '2'), [])] },
    ]),
    tournament('NONE', ['2026-10-01 00:00'], [{ name: 'HE', matches: [] }]),
  ];

  it('lists played matches per tournament and draw, most recent tournament first', () => {
    const results = tournamentResults(profile, tournaments);
    expect(results.map((r) => r.tournament.id)).toEqual(['NEW', 'OLD']);
    expect(results[0].draws.map((d) => d.draw.name)).toEqual(['MD B']);
  });

  it('keeps only the player\'s own matches and remembers their side', () => {
    const [newest] = tournamentResults(profile, tournaments);
    expect(newest.draws[0].matches.map((m) => [m.match_id, m.ownIndex])).toEqual([['2', 1]]);
  });

  it('is empty for a player without played matches', () => {
    expect(tournamentResults({ appearances: [{ tournamentId: 'NONE', playerId: '9' }] }, tournaments)).toEqual([]);
  });

  it('lists a tournament once when the player is entered in several of its events', () => {
    const singles = { name: 'HE A', matches: [played('1', 'Ronde 1', side(true, '7'), side(false, '2'))] };
    const doubles = { name: 'MD A', matches: [played('2', 'Finale', side(true, '8', '4'), side(false, '1', '3')), played('3', 'Ronde 1', side(true, '5', '8'), side(false, '6', '9'))] };
    const entered = { appearances: [{ tournamentId: 'T', playerId: '7' }, { tournamentId: 'T', playerId: '8' }] };
    const results = tournamentResults(entered, [tournament('T', ['2026-09-05 00:00'], [singles, doubles])]);
    expect(results).toHaveLength(1);
    expect(results[0].draws.map((d) => [d.draw.name, d.matches.map((m) => m.match_id)])).toEqual([['HE A', ['1']], ['MD A', ['2', '3']]]);
  });

  it('shows a match once when it is found under two of the player ids', () => {
    const doubles = { name: 'MD A', matches: [played('2', 'Finale', side(true, '7', '8'), side(false, '1', '3'))] };
    const entered = { appearances: [{ tournamentId: 'T', playerId: '7' }, { tournamentId: 'T', playerId: '8' }] };
    const [result] = tournamentResults(entered, [tournament('T', ['2026-09-05 00:00'], [doubles])]);
    expect(result.draws).toHaveLength(1);
    expect(result.draws[0].matches.map((m) => m.match_id)).toEqual(['2']);
  });
});
