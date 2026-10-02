import { fireEvent, screen, within } from '@testing-library/react';

// Shared builders and helpers for the simulator page tests.
export function makePlayer(id, club, rating, extra = {}) {
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
    ...extra,
  };
}

export const LEAGUE_INDEX_FIXTURE = {
  divisions: {
    'Mannen Veer 2': [
      {
        drawId: '12', division: 'Mannen Veer 2', label: 'Mannen Veer 2 afd. 12',
        teams: [
          { clubId: 'c1', club: 'Club A', squad: 'M1' },
          { clubId: 'c2', club: 'Club B', squad: 'M1' },
        ],
      },
      {
        drawId: '13', division: 'Mannen Veer 2', label: 'Mannen Veer 2 afd. 13',
        teams: [
          { clubId: 'c1', club: 'Club A', squad: 'M1' },
          { clubId: 'c1', club: 'Club A', squad: 'M2' },
          { clubId: 'c2', club: 'Club B', squad: 'M1' },
        ],
      },
    ],
    'Mannen Veer 3': [
      { drawId: '20', division: 'Mannen Veer 3', label: 'Mannen Veer 3 afd. 20', teams: [] },
    ],
    Eredivisie: [
      {
        drawId: '30', division: 'Eredivisie', label: 'Eredivisie afd. 1',
        teams: [
          { clubId: 'c1', club: 'Club A', squad: 'M1' },
          { clubId: 'c2', club: 'Club B', squad: 'M1' },
        ],
      },
    ],
    'Mannen Nylon 1': [],
  },
};

export function metaFixture(overrides = {}) {
  return {
    lastUpdated: '2026-01-01T10:00:00Z',
    poolLabel: 'Bondscompetitie 2026-2027 \u2013 Mannen Veer 2 afd. 12',
    leagueIndex: LEAGUE_INDEX_FIXTURE,
    fetchedDrawIds: ['12', '13'],
    poolRosters: {},
    substitutePlayerIds: [],
    playerGenders: {},
    currentPool: { drawId: '12' },
    ...overrides,
  };
}

// Opens a ClubSelect/PlayerSelect dropdown and picks the option with the given text.
export function pickOption(input, optionText) {
  fireEvent.focus(input);
  fireEvent.mouseDown(within(screen.getByRole('listbox')).getByText(optionText));
}
