import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSquadAutoSelect from './useSquadAutoSelect.js';

const teams = [
  { club: 'Club A', squad: 'M1' },
  { club: 'Club B', squad: 'M1' },
  { club: 'Club B', squad: 'M2' },
];

describe('useSquadAutoSelect', () => {
  it.each([
    ['no club is picked', ''],
    ['the club has several teams in the pool', 'Club B'],
    ['the club has no team in the pool', 'Club Z'],
  ])('leaves the squad alone when %s', (_case, club) => {
    const setTeam = vi.fn();
    renderHook(() => useSquadAutoSelect(teams, club, setTeam));
    expect(setTeam).not.toHaveBeenCalled();
  });

  it('selects the squad when the club has exactly one team', () => {
    const setTeam = vi.fn();
    renderHook(() => useSquadAutoSelect(teams, 'Club A', setTeam));
    expect(setTeam).toHaveBeenCalledWith('M1');
  });

  it('selects the squad once the pool teams arrive after the club was picked', () => {
    const setTeam = vi.fn();
    const { rerender } = renderHook(({ poolTeams }) => useSquadAutoSelect(poolTeams, 'Club A', setTeam), {
      initialProps: { poolTeams: [] },
    });
    expect(setTeam).not.toHaveBeenCalled();

    rerender({ poolTeams: teams });
    expect(setTeam).toHaveBeenCalledWith('M1');
  });
});
