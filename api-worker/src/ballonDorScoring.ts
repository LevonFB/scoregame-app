// ballonDorScoring.ts
// Чистый движок подсчёта «Золотого мяча». Формула ballon_dor_v1. Без I/O и БД.
//
// База — 3 очка за каждое угаданное место. Одной базы мало: у случайной
// расстановки 30 имён среднее число совпавших мест равно ровно 1, а знающий
// человек берёт точным местом 2–4 номинантов, поэтому без бонусов весь рейтинг
// сжимается в полосу 0–15 очков и решает везение. Бонусы (те же пять условий,
// что и задания) переносят вес на то, что действительно предсказуемо:
// обладателя и состав тройки.

export const BALLON_DOR_FORMULA_VERSION = "ballon_dor_v1";

export type BallonDorFormulaConfig = {
  version: string;
  /** За каждое совпавшее место. */
  pointsPerExactPlace: number;
  /** Угадан обладатель (1-е место). */
  winnerBonus: number;
  /** Все три призёра в топ-3 игрока — ПО ИМЕНАМ, порядок внутри тройки не важен. */
  top3NamesBonus: number;
  /** Первые 5 строго по местам. */
  top5ExactBonus: number;
  /** Первые 10 строго по местам. */
  top10ExactBonus: number;
  /** Все 30 строго по местам. */
  top30ExactBonus: number;
};

// Бонусы растут примерно вдвое на тир. Живыми в обычной игре будут первые два —
// они и создают разброс; тиры по местам это престиж, который почти никогда не
// выстрелит (ср. top5_<лига>_full_table «Угадать всю таблицу точно»).
export const BALLON_DOR_V1_CONFIG: BallonDorFormulaConfig = {
  version: BALLON_DOR_FORMULA_VERSION,
  pointsPerExactPlace: 3,
  winnerBonus: 15,
  top3NamesBonus: 15,
  top5ExactBonus: 30,
  top10ExactBonus: 60,
  top30ExactBonus: 150,
};

export type BallonDorScoreInput = {
  /** Бюллетень игрока: победитель первым. */
  userRanking: unknown;
  /** Официальный итог: победитель первым. */
  officialRanking: unknown;
  config?: BallonDorFormulaConfig;
};

export type BallonDorScoreBreakdown = {
  place_points: number;
  bonus_points: number;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  exact_places: number;
  /** Флаги — они же источник выполнения заданий. */
  winner_correct: number;
  top3_names_correct: number;
  top5_exact: number;
  top10_exact: number;
  top30_exact: number;
  breakdown: Record<string, unknown>;
  warnings: string[];
};

function toIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const obj = value as { ranking?: unknown } | null | undefined;
    if (obj && Array.isArray(obj.ranking)) return toIdList(obj.ranking);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const item = (raw && typeof raw === "object") ? ((raw as any).player_id ?? (raw as any).id) : raw;
    if (item === null || item === undefined || item === "") continue;
    const id = String(item).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Строго ли совпадает префикс длины `size`. Если у игрока расставлено меньше
 * позиций, чем нужно, — тир не взят (а не «взят по совпавшей части»).
 */
function prefixExact(user: string[], official: string[], size: number): boolean {
  if (official.length < size || user.length < size) return false;
  for (let i = 0; i < size; i++) {
    if (user[i] !== official[i]) return false;
  }
  return true;
}

function sameNames(user: string[], official: string[], size: number): boolean {
  if (official.length < size || user.length < size) return false;
  const officialSet = new Set(official.slice(0, size));
  if (officialSet.size < size) return false;
  for (const id of user.slice(0, size)) {
    if (!officialSet.has(id)) return false;
  }
  return true;
}

export function scoreBallonDorEntry(input: BallonDorScoreInput): BallonDorScoreBreakdown {
  const config = input.config || BALLON_DOR_V1_CONFIG;
  const warnings: string[] = [];
  const user = toIdList(input.userRanking);
  const official = toIdList(input.officialRanking);

  if (!official.length) warnings.push("OFFICIAL_RANKING_EMPTY");
  if (!user.length) warnings.push("USER_RANKING_EMPTY");

  let exactPlaces = 0;
  const limit = Math.min(user.length, official.length);
  for (let i = 0; i < limit; i++) {
    if (user[i] === official[i]) exactPlaces += 1;
  }
  const placePoints = exactPlaces * config.pointsPerExactPlace;

  const winnerCorrect = official.length > 0 && user.length > 0 && user[0] === official[0];
  const top3Names = sameNames(user, official, 3);
  const top5Exact = prefixExact(user, official, 5);
  const top10Exact = prefixExact(user, official, 10);
  const top30Exact = official.length > 0
    && user.length >= official.length
    && prefixExact(user, official, official.length);

  // Бонусы складываются: точный топ-5 включает в себя и обладателя, и тройку.
  let bonusPoints = 0;
  if (winnerCorrect) bonusPoints += config.winnerBonus;
  if (top3Names) bonusPoints += config.top3NamesBonus;
  if (top5Exact) bonusPoints += config.top5ExactBonus;
  if (top10Exact) bonusPoints += config.top10ExactBonus;
  if (top30Exact) bonusPoints += config.top30ExactBonus;

  const totalPoints = placePoints + bonusPoints;
  const maxPossible = computeBallonDorMaxPoints(official.length || 30, config);

  return {
    place_points: placePoints,
    bonus_points: bonusPoints,
    total_points: totalPoints,
    max_possible_points: maxPossible,
    points_pct: maxPossible > 0 ? totalPoints / maxPossible : 0,
    exact_places: exactPlaces,
    winner_correct: winnerCorrect ? 1 : 0,
    top3_names_correct: top3Names ? 1 : 0,
    top5_exact: top5Exact ? 1 : 0,
    top10_exact: top10Exact ? 1 : 0,
    top30_exact: top30Exact ? 1 : 0,
    breakdown: {
      formula: config.version,
      nominee_count: official.length,
      placed_count: user.length,
      points_per_exact_place: config.pointsPerExactPlace,
      bonuses: {
        winner: winnerCorrect ? config.winnerBonus : 0,
        top3_names: top3Names ? config.top3NamesBonus : 0,
        top5_exact: top5Exact ? config.top5ExactBonus : 0,
        top10_exact: top10Exact ? config.top10ExactBonus : 0,
        top30_exact: top30Exact ? config.top30ExactBonus : 0,
      },
    },
    warnings,
  };
}

/** Потолок: все места угаданы плюс все бонусы (тир по местам включает младшие). */
export function computeBallonDorMaxPoints(
  nomineeCount: number,
  config: BallonDorFormulaConfig = BALLON_DOR_V1_CONFIG,
): number {
  return nomineeCount * config.pointsPerExactPlace
    + config.winnerBonus
    + config.top3NamesBonus
    + config.top5ExactBonus
    + config.top10ExactBonus
    + config.top30ExactBonus;
}
