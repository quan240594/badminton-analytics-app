import { describe, it, expect } from 'vitest';
import { nationalRankingFor } from './nationalRanking.js';

describe('nationalRankingFor', () => {
  it('expresses points as a share of the discipline #1 and nulls disciplines without an entry', () => {
    const result = nationalRankingFor(
      { singles: { rank: 5, points: 500 } },
      { singles: { points: 1000, name: 'Top' }, doubles: { points: 800, name: 'Duo' } }
    );

    expect(result.singles).toEqual({ rank: 5, points: 500, topPoints: 1000, topName: 'Top', pctOfTop: 0.5 });
    expect(result.doubles).toBeNull();
    expect(result.mixed).toBeNull();
  });

  it.each([
    ['no top entry for the discipline', {}],
    ['no top data at all', undefined],
    ['a top entry without points', { singles: { name: 'Top' } }],
  ])('leaves top fields null when there is %s', (_label, top) => {
    const { singles } = nationalRankingFor({ singles: { rank: 2, points: 300 } }, top);

    expect(singles).toEqual({ rank: 2, points: 300, topPoints: null, topName: top?.singles?.name ?? null, pctOfTop: null });
  });

  it('returns all-null disciplines for a player without ranking data', () => {
    expect(nationalRankingFor(undefined, {})).toEqual({ singles: null, doubles: null, mixed: null });
  });
});
