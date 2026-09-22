const DEFAULT_RATING = 1500;
const K = 32;

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function makeRatingBook() {
  const book = new Map();
  return {
    get(guid) {
      if (!book.has(guid)) book.set(guid, { rating: DEFAULT_RATING, played: 0, won: 0 });
      return book.get(guid);
    },
    raw: book,
  };
}

function applyDoublesMatch(book, h2hMap, homeGuids, awayGuids, homeWon) {
  const [a1, a2] = homeGuids;
  const [b1, b2] = awayGuids;
  if (new Set([a1, a2, b1, b2]).size !== 4) return;
  const ra1 = book.get(a1);
  const ra2 = book.get(a2);
  const rb1 = book.get(b1);
  const rb2 = book.get(b2);
  const teamARating = (ra1.rating + ra2.rating) / 2;
  const teamBRating = (rb1.rating + rb2.rating) / 2;
  const expA = expectedScore(teamARating, teamBRating);
  const delta = K * ((homeWon ? 1 : 0) - expA);
  ra1.rating += delta;
  ra2.rating += delta;
  rb1.rating -= delta;
  rb2.rating -= delta;
  for (const r of [ra1, ra2, rb1, rb2]) r.played += 1;
  if (homeWon) {
    ra1.won += 1;
    ra2.won += 1;
  } else {
    rb1.won += 1;
    rb2.won += 1;
  }

  const pairKeyA = [a1, a2].sort().join('+');
  const pairKeyB = [b1, b2].sort().join('+');
  const matchupKey = [pairKeyA, pairKeyB].sort().join('_vs_');
  if (!h2hMap.has(matchupKey)) h2hMap.set(matchupKey, {});
  const rec = h2hMap.get(matchupKey);
  const winnerKey = homeWon ? pairKeyA : pairKeyB;
  rec[winnerKey] = (rec[winnerKey] || 0) + 1;
}

export function computeRatings(matches) {
  const singlesBook = makeRatingBook();
  const doublesBook = makeRatingBook();
  const mixedBook = makeRatingBook();
  const singlesH2H = new Map();
  const doublesPairH2H = new Map();
  const mixedPairH2H = new Map();

  for (const match of matches) {
    const homeGuids = match.home.map((p) => p.guid).filter(Boolean);
    const awayGuids = match.away.map((p) => p.guid).filter(Boolean);
    const homeWon = match.winnerSide === 'home';

    // Skip matches where an opponent never had their own page fetched (no resolvable guid).
    if (match.discipline === 'singles' && homeGuids.length === 1 && awayGuids.length === 1) {
      const [a] = homeGuids;
      const [b] = awayGuids;
      if (a === b) continue;
      const ra = singlesBook.get(a);
      const rb = singlesBook.get(b);
      const expA = expectedScore(ra.rating, rb.rating);
      const delta = K * ((homeWon ? 1 : 0) - expA);
      ra.rating += delta;
      rb.rating -= delta;
      ra.played += 1;
      rb.played += 1;
      if (homeWon) ra.won += 1;
      else rb.won += 1;

      const h2hKey = [a, b].sort().join('|');
      if (!singlesH2H.has(h2hKey)) singlesH2H.set(h2hKey, {});
      const rec = singlesH2H.get(h2hKey);
      const winner = homeWon ? a : b;
      rec[winner] = (rec[winner] || 0) + 1;
    } else if (match.discipline === 'doubles' && homeGuids.length === 2 && awayGuids.length === 2) {
      applyDoublesMatch(doublesBook, doublesPairH2H, homeGuids, awayGuids, homeWon);
    } else if (match.discipline === 'mixed' && homeGuids.length === 2 && awayGuids.length === 2) {
      applyDoublesMatch(mixedBook, mixedPairH2H, homeGuids, awayGuids, homeWon);
    }
  }

  return {
    singles: singlesBook.raw,
    doublesPlayer: doublesBook.raw,
    mixedPlayer: mixedBook.raw,
    singlesH2H,
    doublesPairH2H,
    mixedPairH2H,
  };
}

export function winProbability(ratingA, ratingB) {
  return expectedScore(ratingA, ratingB);
}
