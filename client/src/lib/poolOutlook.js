import { teamKey, teamsInDraw } from './tournamentDraws.js';

function recordedRanks(draw, teams, byRank) {
  const matches = draw.matches ?? [];
  const completed = matches.length > 0 && matches.every((match) => match.sides.some((side) => side.won));
  const standings = draw.standings ?? [];
  if (!completed || standings.length !== teams.length || new Set(standings.map((row) => row.rank)).size !== teams.length) return null;
  for (const row of standings) {
    const key = teamKey(row.players.map((player) => player.player_id));
    const rank = byRank[row.rank - 1];
    if (!rank?.has(key)) return { teams, byRank: null, tieP: null, sweep: null };
    rank.get(key).p = 1;
  }
  return { teams, byRank, tieP: 0, sweep: null };
}

function fixtureProbability(match, first, second, model) {
  const winner = match?.sides.find((side) => side.won);
  return winner
    ? Number(teamKey(winner.players.map((player) => player.player_id)) === teamKey(first))
    : model.winProbability(first, second);
}

function poolFixtures(draw, teams, model) {
  const matches = draw.matches ?? [];
  const keys = teams.map(teamKey);
  const pairs = [];
  for (let first = 0; first < teams.length; first += 1) {
    for (let second = first + 1; second < teams.length; second += 1) {
      const played = matches.filter((match) => {
        const sides = new Set(match.sides.map((side) => teamKey(side.players.map((player) => player.player_id))));
        return sides.has(keys[first]) && sides.has(keys[second]);
      });
      const fixtures = played.length ? played : [null];
      for (const match of fixtures) {
        const probability = fixtureProbability(match, teams[first], teams[second], model);
        if (probability == null) return null;
        pairs.push({ first, second, probability });
      }
    }
  }
  return pairs;
}

export function analyzePool(draw, model) {
  const teams = teamsInDraw(draw);
  const keys = teams.map(teamKey);
  const byRank = teams.map(() => new Map(teams.map((team) => [teamKey(team), { team, p: 0 }])));
  const recorded = recordedRanks(draw, teams, byRank);
  if (recorded) return recorded;
  const pairs = poolFixtures(draw, teams, model);
  if (!teams.length || !pairs || pairs.filter(({ probability }) => probability > 0 && probability < 1).length > 18) {
    return { teams, byRank: null, tieP: null, sweep: null };
  }
  const wins = teams.map(() => 0);
  const losses = teams.map(() => 0);
  const sweep = teams.map(() => 0);
  let tieP = 0;
  const visit = (index, mass) => {
    if (index < pairs.length) {
      const { first, second, probability } = pairs[index];
      for (const [winner, loser, chance] of [[first, second, probability], [second, first, 1 - probability]]) {
        if (!chance) continue;
        wins[winner] += 1;
        losses[loser] += 1;
        visit(index + 1, mass * chance);
        wins[winner] -= 1;
        losses[loser] -= 1;
      }
      return;
    }
    const ordered = [...new Set(wins)].sort((first, second) => second - first);
    let rank = 0;
    for (const score of ordered) {
      const tied = teams.map((_, index) => index).filter((index) => wins[index] === score);
      if (rank === 0 && tied.length > 1) tieP += mass;
      for (let offset = 0; offset < tied.length; offset += 1) {
        for (const index of tied) byRank[rank + offset].get(keys[index]).p += mass / tied.length;
      }
      rank += tied.length;
    }
    teams.forEach((_, index) => { if (!losses[index]) sweep[index] += mass; });
  };
  visit(0, 1);
  return { teams, byRank, tieP, sweep };
}

export const poolGroup = (draw) => draw.name?.match(/(?:Groep|Group)\s+([a-z0-9]+)\s*$/i)?.[1].toUpperCase() ?? null;