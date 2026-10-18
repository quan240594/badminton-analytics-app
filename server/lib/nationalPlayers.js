import { nationalRankingFor } from './nationalRanking.js';

const SITE_URL = 'https://badmintonnederland.toernooi.nl';
// The adult list wins when a player is on it; the junior list is on another point scale, so the two are never mixed.
const LIST_PRIORITY = ['75', '164'];

// "Mannen Enkel" / "Vrouwen Dubbel" / "Gemengd Dubbel": gender is irrelevant to the discipline.
export function disciplineOf(label) {
  if (label.includes('Gemengd')) return 'mixed';
  if (label.includes('Enkel')) return 'singles';
  if (label.includes('Dubbel')) return 'doubles';
  return null;
}

// {list id: {category label: {name, points, rank}}}: the best-ranked player of each category, what others are measured against.
function topEntries(players) {
  const tops = {};
  for (const { name, ranks } of Object.values(players)) {
    for (const [listId, { rankings }] of Object.entries(ranks)) {
      for (const [label, entry] of Object.entries(rankings)) {
        const category = (tops[listId] ??= {});
        if (entry.rank != null && (!category[label] || entry.rank < category[label].rank)) {
          category[label] = { name, points: entry.points, rank: entry.rank };
        }
      }
    }
  }
  return tops;
}

function rankingOf(player, tops) {
  const listId = LIST_PRIORITY.find((id) => player.ranks[id]);
  if (!listId) return null;
  const own = {};
  const top = {};
  for (const [label, entry] of Object.entries(player.ranks[listId].rankings)) {
    const discipline = disciplineOf(label);
    if (!discipline || entry.rank == null) continue;
    own[discipline] = entry;
    top[discipline] = tops[listId]?.[label];
  }
  return Object.keys(own).length > 0 ? nationalRankingFor(own, top) : null;
}

// Everyone on the national ranking lists (data/national_players.json), keyed by MemberID, with
// the ranking in the shape the tournament players' nationalRanking already has.
export function buildNationalPlayers(state) {
  const players = state?.players ?? {};
  const tops = topEntries(players);
  return Object.entries(players).flatMap(([memberId, player]) => {
    const nationalRanking = rankingOf(player, tops);
    if (!nationalRanking) return [];
    return [{ id: memberId, name: player.name, memberId, url: `${SITE_URL}/find/player?q=${memberId}`, nationalRanking }];
  });
}
