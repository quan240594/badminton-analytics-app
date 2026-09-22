// Dutch club badminton (Bondscompetitie) seasons run roughly September-May,
// spanning two calendar years, so "current season" depends on today's date
// rather than being a value that's ever safe to hard-code.
export function currentSeasonLabel(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}
