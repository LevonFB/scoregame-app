// Порядок мест в глобальном рейтинге за день и неделю.
// При равных очках: больше точных счетов → больше угаданных разниц → больше
// угаданных исходов. Если совпало всё — место общее («1, 2, 2, 4»).
// Копия правила живёт в bot-worker (getGlobalDayRanks) — менять вместе.

export type TieBreakStats = {
  points: number;
  exactCount: number;
  diffCount: number;
  outcomeCount: number;
};

export function compareTieBreakStats(a: TieBreakStats, b: TieBreakStats): number {
  return (
    b.points - a.points ||
    b.exactCount - a.exactCount ||
    b.diffCount - a.diffCount ||
    b.outcomeCount - a.outcomeCount
  );
}

// Сортирует и проставляет общее место. Внутри полной ничьей порядок
// стабилизирован по userId только ради детерминированного списка — на место
// он не влияет.
export function rankWithSharedPlaces<T extends TieBreakStats & { userId: number }>(
  rows: T[]
): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => compareTieBreakStats(a, b) || a.userId - b.userId);
  const ranked: Array<T & { rank: number }> = [];
  sorted.forEach((row, index) => {
    const prev = ranked[index - 1];
    const rank = prev && compareTieBreakStats(prev, row) === 0 ? prev.rank : index + 1;
    ranked.push({ ...row, rank });
  });
  return ranked;
}
