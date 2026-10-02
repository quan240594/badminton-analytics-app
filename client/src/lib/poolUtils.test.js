import { describe, it, expect } from 'vitest';
import {
  percentForRunStatus, githubRunFailureMessage, afdelingNumber, divisionRank, poolLabelSuffix,
  clearIdIfClubMismatch, clearMismatchedIds,
} from './poolUtils.js';

describe('percentForRunStatus', () => {
  it.each([['completed', 100], ['in_progress', 60], ['queued', 15], [undefined, 15]])(
    'maps %s to %i%%',
    (status, percent) => expect(percentForRunStatus(status)).toBe(percent)
  );
});

describe('githubRunFailureMessage', () => {
  it('names the conclusion and points at the Actions tab', () => {
    expect(githubRunFailureMessage('failure')).toBe(
      'GitHub Actions run finished with "failure" — check the Actions tab for details.'
    );
  });
});

describe('afdelingNumber', () => {
  it.each([['Mannen Veer 2 afd. 12', 12], ['afd.  3', 3], ['no number here', 0], [undefined, 0]])(
    'reads the afdeling number from %j',
    (label, expected) => expect(afdelingNumber(label)).toBe(expected)
  );
});

describe('divisionRank', () => {
  it.each([
    ['Eredivisie', 0], ['eredivisie', 0], ['1e divisie', 1], ['3e Divisie', 3],
    ['Mannen Veer 2', Infinity], ['', Infinity], [undefined, Infinity],
  ])('ranks %j as %s', (division, rank) => expect(divisionRank(division)).toBe(rank));
});

describe('poolLabelSuffix', () => {
  it.each([
    ['Mannen Veer 2 afd. 12', 'Mannen Veer 2', 'Afd. 12'],
    ['afd. 3', 'Mannen Veer 2', 'Afd. 3'],
  ])('turns %j (division %j) into %j', (label, division, expected) => {
    expect(poolLabelSuffix(label, division)).toBe(expected);
  });
});

describe('clearing ids on a club mismatch', () => {
  const byId = new Map([['a1', { club: 'Club A' }], ['b1', { club: 'Club B' }]]);

  it.each([
    ['keeps an id whose player is in the club', 'a1', 'a1'],
    ['clears an id whose player is in another club', 'b1', ''],
    ['keeps an empty slot', '', ''],
    ['keeps an id with no known player', 'ghost', 'ghost'],
  ])('%s', (_case, id, expected) => {
    expect(clearIdIfClubMismatch(id, 'Club A', byId)).toBe(expected);
  });

  it('applies the rule to every slot', () => {
    expect(clearMismatchedIds(['a1', 'b1', ''], 'Club A', byId)).toEqual(['a1', '', '']);
  });
});
