const hasAnyRanking = (ranking) => Boolean(ranking) && ['singles', 'doubles', 'mixed'].some((discipline) => ranking[discipline]);

// "Hoang, Linh" -> "Linh Hoang"; an infix stays after the first name on the site
// ("Pol, Pancho van de"), so it ends up in front of the family name.
export function displayName(name) {
  const [last, ...rest] = String(name ?? '').split(', ');
  return rest.length > 0 ? `${rest.join(', ')} ${last}` : last;
}

function newProfile(player, appearance) {
  return {
    id: player.url,
    name: player.name,
    country: player.country ?? null,
    memberId: player.memberId ?? null,
    url: player.url,
    profile: player.profile ?? null,
    nationalRanking: player.nationalRanking ?? null,
    tournaments: player.tournaments ?? [],
    appearances: [appearance],
  };
}

// Another entry of someone already known: add where they were entered and fill what is missing.
function mergeEntry(found, player, appearance) {
  found.appearances.push(appearance);
  found.profile ??= player.profile ?? null;
  found.country ??= player.country ?? null;
  found.memberId ??= player.memberId ?? null;
  if (!hasAnyRanking(found.nationalRanking) && hasAnyRanking(player.nationalRanking)) found.nationalRanking = player.nationalRanking;
}

// A person is entered in many tournaments under a different local id each time. Their
// link is the same everywhere (their profile page, or their MemberID search), so it
// identifies them; a player the site could not resolve has one link per tournament.
function profilesFromTournaments(tournaments) {
  const byUrl = new Map();
  const entries = tournaments.flatMap((tournament) => (tournament.players ?? []).map((player) => ({ player, appearance: { tournamentId: tournament.id, playerId: player.id } })));
  for (const { player, appearance } of entries) {
    if (!player.url) continue;
    const found = byUrl.get(player.url);
    if (found) mergeEntry(found, player, appearance);
    else byUrl.set(player.url, newProfile(player, appearance));
  }
  return [...byUrl.values()];
}

// Someone only on the national ranking lists: no tournament entries, just their ranking.
function nationalProfile(player) {
  return { id: player.url, name: player.name, country: null, memberId: player.memberId, url: player.url, profile: null, nationalRanking: player.nationalRanking, tournaments: [], appearances: [] };
}

// Tournament entrants plus everyone on the national ranking lists. The MemberID joins the two
// (never a name); an entrant keeps their own profile and only borrows a ranking they lack.
export function buildProfiles(tournaments, nationalPlayers = []) {
  const profiles = profilesFromTournaments(tournaments);
  const byMemberId = new Map(profiles.filter((p) => p.memberId).map((p) => [p.memberId, p]));
  for (const national of nationalPlayers) {
    const found = byMemberId.get(national.memberId);
    if (!found) profiles.push(nationalProfile(national));
    else if (!hasAnyRanking(found.nationalRanking)) found.nationalRanking = national.nationalRanking;
  }
  return profiles.sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)));
}

const PLAYED_AT_RE = /(\d{1,2})-(\d{1,2})-(\d{4})/;

// "za 5-9-2026 16:00" -> a local date (the time of day is not needed).
export function parsePlayedAt(text) {
  const match = PLAYED_AT_RE.exec(text ?? '');
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

// The player's played matches in one draw, each remembering which side was theirs. A match
// without a score has not been played, so it is left out.
function ownPlayedMatches(draw, playerId) {
  return (draw.matches ?? []).flatMap((match) => {
    if (!match.games?.length) return [];
    const ownIndex = match.sides.findIndex((side) => side.players.some((p) => p.player_id === playerId));
    return ownIndex >= 0 ? [{ ...match, ownIndex }] : [];
  });
}

const drawsPlayedIn = (tournament, playerId) => (tournament.draws ?? [])
  .map((draw) => ({ draw, matches: ownPlayedMatches(draw, playerId) }))
  .filter(({ matches }) => matches.length > 0);

const startOf = ({ tournament }) => tournament.dates?.[0] ?? '';

// The matches the player has played, per tournament (most recent first) and per draw.
export function tournamentResults(profile, tournaments) {
  const byId = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  return profile.appearances
    .map(({ tournamentId, playerId }) => {
      const tournament = byId.get(tournamentId);
      const draws = tournament ? drawsPlayedIn(tournament, playerId) : [];
      return draws.length > 0 ? { tournament, draws } : null;
    })
    .filter(Boolean)
    .sort((a, b) => startOf(b).localeCompare(startOf(a)));
}
