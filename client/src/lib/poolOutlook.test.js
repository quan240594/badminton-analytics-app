import { describe, it, expect } from 'vitest';
import { analyzePool } from './poolOutlook.js';
import { disciplineForDraw } from './tournamentDraws.js';
import { buildBracket, analyzeBracket, describeBracket } from './knockout.js';

const teams = [['1'], ['2'], ['3']];
const draw = { standings: teams.map((team) => ({ players: team.map((player_id) => ({ player_id })) })) };
const model = { isRated: () => true, winProbability: () => 0.5 };

describe('pool qualification', () => {
  it.each([['ME 8', 'singles'], ['VE 4', 'singles'], ['MD 6', 'doubles'], ['VD 6', 'doubles'], ['GD 6', 'mixed']])('recognizes discipline %s', (name, expected) => {
    expect(disciplineForDraw(name)).toBe(expected);
  });
  it('distinguishes winning both from first place after a shared tie', () => {
    const result = analyzePool(draw, model);
    expect(result.sweep[0]).toBeCloseTo(0.25);
    expect(result.tieP).toBeCloseTo(0.25);
    expect(result.byRank[0].get('1').p).toBeCloseTo(1 / 3);
    for (const rank of result.byRank) expect([...rank.values()].reduce((sum, entry) => sum + entry.p, 0)).toBeCloseTo(1);
  });
  it('does not estimate missing rankings', () => {
    expect(analyzePool(draw, { winProbability: () => null }).byRank).toBeNull();
  });
  it('uses recorded finishing ranks for a completed group, even without ratings', () => {
    const completed = {
      standings: draw.standings.map((row, index) => ({ ...row, rank: index + 1 })),
      matches: [[0, 1], [0, 2], [1, 2]].map(([first, second]) => ({ sides: [
        { players: draw.standings[first].players, won: true },
        { players: draw.standings[second].players, won: false },
      ] })),
    };
    expect(analyzePool(completed, { winProbability: () => null }).byRank[0].get('1').p).toBe(1);
  });
  it('carries qualification through a bye and a semifinal', () => {
    const side = (qualifier) => ({ players: [], qualifier });
    const matches = [
      { round: 'Finale', sides: [{ players: [] }, { players: [] }] },
      { round: 'Halve finale', sides: [side({ group: 'A', rank: 1 }), { players: [], bye: true }] },
      { round: 'Halve finale', sides: [side({ group: 'B', rank: 1 }), { players: [], bye: true }] },
    ];
    const root = buildBracket({ matches }, ({ group }) => group === 'A' ? { team: ['1'] } : { poolTeams: [['4']], entries: new Map([['4', { team: ['4'], p: 1 }]]) });
    const result = analyzeBracket(root, ['1'], model, 1 / 3);
    expect(result.rounds[0].status).toBe('bye');
    expect(result.rounds[1].reach).toBeCloseTo(1 / 3);
    expect(result.titleP).toBeCloseTo(1 / 6);
  });
  it('keeps possible opponents visible when a feeder group cannot be forecast', () => {
    const root = { round: 'Finale', a: { team: ['1'] }, b: { poolTeams: [['2'], ['3']], entries: null } };
    const uncertain = { isRated: (team) => !team.includes('3'), winProbability: (first, second) => second.includes('3') ? null : 0.6 };
    const result = analyzeBracket(root, ['1'], uncertain, 0.4);
    expect(result.titleP).toBeNull();
    expect(result.rounds[0].candidates).toEqual([{ team: ['2'], winP: 0.6 }, { team: ['3'], winP: null }]);
  });
  it('describes the full playoff tree with group probabilities and byes', () => {
    const group = { label: 'Group A #1', poolTeams: [['1'], ['2']], entries: new Map([['1', { team: ['1'], p: 0.6 }], ['2', { team: ['2'], p: 0.4 }]]) };
    const root = { round: 'Finale', a: { round: 'Halve finale', a: group, b: { bye: true } }, b: { team: ['3'] } };
    const tree = describeBracket(root, ['1'], model);
    expect(tree.selected).toBe(true);
    expect(tree.children[0].sides[0].label).toBe('Group A #1');
    expect(tree.children[0].sides[1].bye).toBe(true);
    expect(tree.sides[0].candidates[0].p).toBeCloseTo(0.6);
    expect(tree.sides[1].candidates[0].winP).toBeCloseTo(0.5);
  });
  it('reconstructs interleaved knockout rounds by their stage names', () => {
    const side = (player_id) => ({ players: player_id ? [{ player_id }] : [] });
    const match = (round, first, second) => ({ round, sides: [side(first), side(second)] });
    const root = buildBracket({ matches: [match('Halve finale', '1', '2'), match('Finale'), match('Halve finale', '3', '4')] });
    expect(root.round).toBe('Finale');
    expect(root.a.a.team).toEqual(['1']);
    expect(root.b.b.team).toEqual(['4']);
  });
  it('positions completed byes using the teams already present in the next round', () => {
    const side = (player_id) => ({ players: player_id ? [{ player_id }] : [] });
    const match = (round, first, second) => ({ round, sides: [side(first), side(second)] });
    const bye = (player_id) => ({ round: 'Kwartfinale', sides: [{ ...side(player_id), won: true }, { players: [], bye: true }] });
    const root = buildBracket({ matches: [
      bye('1'), bye('3'), match('Kwartfinale', '2', '5'), match('Kwartfinale', '4', '6'),
      match('Finale'), match('Halve finale', '1'), match('Halve finale', '3'),
    ] });
    expect(root.a.a.a.team).toEqual(['1']);
    expect(root.a.b.a.team).toEqual(['2']);
    expect(root.b.a.a.team).toEqual(['3']);
    expect(root.b.b.a.team).toEqual(['4']);
  });
});