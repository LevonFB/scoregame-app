// seasonPredictionTaskRewards.ts
// Stage E10.2 — pure helpers for SEASON-PREDICTION task rewards.
//
// No I/O, no DB, no economy writes. This module owns:
//   • the reward-eligible task catalog (task_key → category/tournament/phase/title)
//   • the STARTER default rewards (admin-editable; stored config overrides them)
//   • validation/normalization of an admin reward config
//   • effective-reward resolution (stored ?? default)
//   • claim-status derivation + a pure claim resolver (used by the endpoint AND tests)
//   • the per-(season,user,task) claim dedup key
//   • the theoretical-max reward summary for the admin panel
//
// Actual granting happens in index.ts via the shared idempotent reward_ledger; recalc
// NEVER grants — it only flips a task's status. A task is claimable only when its
// reward is enabled & non-zero AND its status is "completed" AND it wasn't claimed yet.

// Canonical shop_cases codes used by the project economy (mirrors seasonPredictionRewards.ts).
export const SEASON_TASK_REWARD_PREMIUM_CASE = "premium";
export const SEASON_TASK_REWARD_STANDARD_CASE = "daily_free";

export type SeasonTaskRewardCategory = "top5" | "europe" | "start" | "ballon_dor";
export type SeasonTaskRewardPhase = "league" | "ties" | "bracket" | "result";

// Boosts that may be granted as a season-task reward (same set the Weekly Challenge
// uses). "extra_joker" = Джокер, "double_chance" = Двойной шанс. Granted as rows in
// user_boosts by the shared idempotent reward_ledger delivery.
export const SEASON_TASK_ALLOWED_BOOST_TYPES = ["extra_joker", "double_chance"] as const;
export const SEASON_TASK_DEFAULT_BOOST_TYPE = "extra_joker";
export const SEASON_TASK_BOOST_MAX = 10;

// The progress status a season-prediction task can have (mirrors index.ts payload).
export type SeasonTaskStatus = "available" | "in_progress" | "completed" | "future" | "failed";
export type SeasonTaskClaimStatus = "not_claimable" | "claimable" | "claimed";

// A reward bundle (balls / stars / cases). enabled gates the whole bundle.
export type TaskRewardSpec = {
  enabled: boolean;
  balls: number;
  stars: number;
  case_type: string | null;
  case_count: number;
  lucky_tokens: number;
  boost_type: string | null;
  boost_count: number;
};

// Stored admin config row (DB) — same shape as TaskRewardSpec + metadata.
export type TaskRewardConfig = TaskRewardSpec & {
  task_key: string;
  title_override: string | null;
  admin_note: string | null;
  updated_at?: number | null;
  updated_by?: number | null;
};

export type TaskRewardConfigInput = {
  enabled?: boolean;
  balls?: number;
  stars?: number;
  case_type?: string | null;
  case_count?: number;
  lucky_tokens?: number;
  boost_type?: string | null;
  boost_count?: number;
  title_override?: string | null;
  admin_note?: string | null;
};

export type TaskRewardCatalogEntry = {
  task_key: string;
  title: string;
  category: SeasonTaskRewardCategory;
  tournament: string; // cup/league code or "aggregate"
  phase: SeasonTaskRewardPhase;
  default: TaskRewardSpec;
};

// The user-facing reward payload (null when the task carries no active reward).
export type TaskRewardPayload = { stars: number; balls: number; case_type: string | null; case_count: number; lucky_tokens: number; boost_type: string | null; boost_count: number };

export const SEASON_TASK_REWARD_CASE_OPTIONS = [
  SEASON_TASK_REWARD_PREMIUM_CASE,
  SEASON_TASK_REWARD_STANDARD_CASE,
] as const;

// Upper bound for a configurable lucky-token (Жетон) reward on a single task.
export const SEASON_TASK_LUCKY_TOKEN_MAX = 50;

export const EUROCUP_TASK_CUPS: Array<{ code: string; label: string; short: string }> = [
  { code: "UCL", label: "Лига чемпионов", short: "ЛЧ" },
  { code: "UEL", label: "Лига Европы", short: "ЛЕ" },
  { code: "UECL", label: "Лига конференций", short: "ЛК" },
];

export const TOP5_TASK_LEAGUES: Array<{ code: string; label: string }> = [
  { code: "PL", label: "АПЛ" },
  { code: "PD", label: "Ла Лига" },
  { code: "SA", label: "Серия А" },
  { code: "BL1", label: "Бундеслига" },
  { code: "FL1", label: "Лига 1" },
];

// Reward bundle constructors (keep the catalog readable).
function R(balls: number, stars = 0, caseType: string | null = null, caseCount = 0, luckyTokens = 0): TaskRewardSpec {
  return { enabled: true, balls, stars, case_type: caseType, case_count: caseCount, lucky_tokens: luckyTokens, boost_type: null, boost_count: 0 };
}
// Same as R(), plus a boost. Boosts can't be hoarded — at most one paid boost per
// day and Extra Joker / Double Chance are mutually exclusive — so they pull the
// winner back into the daily game for days instead of sitting in a wallet.
function RB(balls: number, stars: number, boostType: string, boostCount: number, luckyTokens = 0): TaskRewardSpec {
  return { enabled: true, balls, stars, case_type: null, case_count: 0, lucky_tokens: luckyTokens, boost_type: boostType, boost_count: boostCount };
}
const OFF: TaskRewardSpec = { enabled: false, balls: 0, stars: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 };
// Disabled-by-default suggestion: carries a pre-filled star value the admin sees in
// the panel, but stays OFF (contributes nothing to the theoretical max) until the
// admin explicitly enables it. Used for the after-results top-5 tasks.
function ROFF(stars: number): TaskRewardSpec {
  return { enabled: false, balls: 0, stars, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 };
}

// ── Catalog ───────────────────────────────────────────────────────────────────
// Reward-eligible season-prediction tasks (excludes `*_future_*` placeholders that
// never complete, and the start/weekly sections). task_key values match the ids
// produced by buildSeasonPredictionTasksResponse / buildEurocupKnockoutTaskViews.
export function buildSeasonTaskRewardCatalog(): TaskRewardCatalogEntry[] {
  const out: TaskRewardCatalogEntry[] = [];
  const europe = (task_key: string, title: string, tournament: string, phase: SeasonTaskRewardPhase, def: TaskRewardSpec) =>
    out.push({ task_key, title, category: "europe", tournament, phase, default: def });
  const top5 = (task_key: string, title: string, tournament: string, def: TaskRewardSpec) =>
    out.push({ task_key, title, category: "top5", tournament, phase: "league", default: def });
  const start = (task_key: string, title: string, def: TaskRewardSpec) =>
    out.push({ task_key, title, category: "start", tournament: "start", phase: "league", default: def });

  // ── Start · onboarding (economy-v1.md §C — отступление от §21: рутина 1⭐, веха — жетон) ──
  start("start_first_prediction", "Первый прогноз сезона", R(0, 1));
  start("start_first_table", "Первая таблица", R(0, 1));
  start("start_individual_pick", "Индивидуальный выбор", R(0, 1));
  start("start_full_league", "Полный прогноз лиги", R(0, 1));
  start("start_big_start", "Большой старт", R(0, 0, null, 0, 1));

  // ── Top-5 · activity (economy-v1.md §C: рутина 1⭐, вехи — жетон, финал — Premium) ──
  for (const l of TOP5_TASK_LEAGUES) {
    top5(`top5_${l.code}_fill_table`, `Заполнить таблицу ${l.label}`, l.code, R(0, 1));
    top5(`top5_${l.code}_submit_prediction`, `Подтвердить прогноз ${l.label}`, l.code, R(0, 1));
    top5(`top5_${l.code}_pick_awards`, `Индивидуальные награды ${l.label}`, l.code, R(0, 1));
    top5(`top5_${l.code}_complete`, `Завершить прогноз ${l.label}`, l.code, R(0, 1));
  }
  top5("top5_submit_2", "Подтвердить 2 лиги топ-5", "aggregate", R(0, 1));
  top5("top5_submit_3", "Подтвердить 3 лиги топ-5", "aggregate", R(0, 2));
  top5("top5_submit_5", "Подтвердить все 5 лиг топ-5", "aggregate", R(0, 0, null, 0, 1));
  top5("top5_awards_all", "Награды во всех 5 лигах", "aggregate", R(0, 0, null, 0, 1));
  top5("top5_complete_all", "Завершить все топ-5 прогнозы", "aggregate", R(0, 0, SEASON_TASK_REWARD_PREMIUM_CASE, 1));

  // ── Top-5 · after-results (phase "result") ────────────────────────────────────
  // Completion is derived from season_prediction_user_scores in the task builder
  // (champion_correct / exact_positions / awards_correct). Defaults are OFF with a
  // suggested star value: the admin turns them on and tunes rewards in the panel.
  const top5res = (task_key: string, title: string, tournament: string, def: TaskRewardSpec) =>
    out.push({ task_key, title, category: "top5", tournament, phase: "result", default: def });
  for (const l of TOP5_TASK_LEAGUES) {
    top5res(`top5_${l.code}_champion`, `Угадать чемпиона ${l.label}`, l.code, ROFF(3));
    top5res(`top5_${l.code}_ucl_zone`, `Угадать зону Лиги чемпионов ${l.label}`, l.code, ROFF(4));
    top5res(`top5_${l.code}_uel_zone`, `Угадать зону Лиги Европы ${l.label}`, l.code, ROFF(3));
    top5res(`top5_${l.code}_uecl_zone`, `Угадать зону Лиги конференций ${l.label}`, l.code, ROFF(3));
    top5res(`top5_${l.code}_relegation_zone`, `Угадать зону вылета ${l.label}`, l.code, ROFF(4));
    top5res(`top5_${l.code}_full_table`, `Угадать всю таблицу ${l.label} точно`, l.code, ROFF(20));
    top5res(`top5_${l.code}_awards_hit`, `Угадать индивидуальные награды ${l.label}`, l.code, ROFF(2));
  }
  top5res("top5_champions_multi", "Угадать чемпионов нескольких лиг топ-5", "aggregate", ROFF(5));
  top5res("top5_awards_multi", "Угадать индивидуальные награды в разных лигах топ-5", "aggregate", ROFF(4));

  // ── Eurocups · league stage · activity (economy-v1.md §C: рутина 1⭐, веха — жетон) ──
  for (const c of EUROCUP_TASK_CUPS) {
    europe(`europe_${c.code}_start`, `Начать прогноз стадии лиги ${c.short}`, c.code, "league", R(0, 1));
    europe(`europe_${c.code}_top8`, `Заполнить Топ-8 ${c.short}`, c.code, "league", R(0, 1));
    europe(`europe_${c.code}_zone_9_24`, `Заполнить зону 9–24 ${c.short}`, c.code, "league", R(0, 1));
    europe(`europe_${c.code}_submit`, `Подтвердить стадию лиги ${c.short}`, c.code, "league", R(0, 1));
  }
  europe("europe_submit_any", "Подтвердить любой еврокубок", "aggregate", "league", R(0, 1));
  europe("europe_submit_2", "Подтвердить 2 еврокубка", "aggregate", "league", R(0, 1));
  europe("europe_submit_3", "Подтвердить все 3 еврокубка", "aggregate", "league", R(0, 0, null, 0, 1));
  europe("europe_top8_all", "Топ-8 во всех еврокубках", "aggregate", "league", R(0, 2));
  europe("europe_zone_all", "Зона 9–24 во всех еврокубках", "aggregate", "league", R(0, 2));

  // ── Eurocups · league stage · RESULTS (phase "league" — same tournament stage) ─
  // The heaviest prediction in the mode: 36 teams × 3 cups, filled in September and
  // settled at the end of January. Stars carry the reachable tiers, boosts the mid
  // tier, balls / tokens / case only the rare feats. Two partial tiers (6/8 and
  // 20/24) sit under the all-or-nothing ones, mirroring ties_4/6/8 in the play-off
  // phase. Max: 268⭐ + 19⚽ + 8 Extra Joker + 3 Double Chance + 5 tokens + 1 Premium.
  for (const c of EUROCUP_TASK_CUPS) {
    europe(`europe_${c.code}_res_points_50`, `50+ очков за стадию лиги ${c.short}`, c.code, "league", R(0, 6));
    europe(`europe_${c.code}_res_points_75`, `75+ очков за стадию лиги ${c.short}`, c.code, "league", RB(0, 12, "double_chance", 1));
    europe(`europe_${c.code}_res_top24_20`, `20 из 24 участников плей-офф ${c.short}`, c.code, "league", RB(0, 8, SEASON_TASK_DEFAULT_BOOST_TYPE, 1));
    europe(`europe_${c.code}_res_top24_all`, `Все 24 участника плей-офф ${c.short}`, c.code, "league", RB(0, 12, SEASON_TASK_DEFAULT_BOOST_TYPE, 1));
    europe(`europe_${c.code}_res_top8_6`, `6 из 8 в топ-8 ${c.short}`, c.code, "league", R(0, 8, null, 0, 1));
    europe(`europe_${c.code}_res_top8_all`, `Весь топ-8 ${c.short}`, c.code, "league", R(3, 25));
  }
  europe("europe_res_points_50_all", "50+ очков во всех еврокубках", "aggregate", "league", RB(0, 15, SEASON_TASK_DEFAULT_BOOST_TYPE, 2));
  europe("europe_res_points_75_all", "75+ очков во всех еврокубках", "aggregate", "league", R(5, 30, null, 0, 1));
  europe("europe_res_top8_any", "Весь топ-8 в любом еврокубке", "aggregate", "league", R(5, 10, SEASON_TASK_REWARD_PREMIUM_CASE, 1, 1));

  // ── Eurocups · per-cup ties + bracket actions + results (STARTER defaults) ────
  // E10.4: defaults lowered to a calmer starter balance (~145 мячей / ~139 звёзд /
  // 1 кейс). Activity = small balls only; results carry the stars; the single case
  // is reserved for the rarest aggregate ("чемпионы всех 3 еврокубков").
  for (const c of EUROCUP_TASK_CUPS) {
    // Ties — actions (balls only)
    europe(`ek_ties_${c.code}_fill`, `Заполнить стыки ${c.short}`, c.code, "ties", R(1));
    europe(`ek_ties_${c.code}_submit`, `Подтвердить стыки ${c.short}`, c.code, "ties", R(2));
    // Bracket — actions (balls only)
    europe(`ek_bracket_${c.code}_fill`, `Заполнить сетку ${c.short} до чемпиона`, c.code, "bracket", R(2));
    europe(`ek_bracket_${c.code}_submit`, `Подтвердить сетку ${c.short}`, c.code, "bracket", R(3));
    // Ties — results (≤4 stars per-cup)
    europe(`ek_res_${c.code}_ties_4`, `Угадать 4 из 8 в стыках ${c.short}`, c.code, "ties", R(1));
    europe(`ek_res_${c.code}_ties_6`, `Угадать 6 из 8 в стыках ${c.short}`, c.code, "ties", R(1, 1));
    europe(`ek_res_${c.code}_ties_8`, `Угадать 8 из 8 в стыках ${c.short}`, c.code, "ties", R(2, 4));
    // Bracket — results (≤6 stars per-cup)
    europe(`ek_res_${c.code}_semis`, `Угадать всех 4 полуфиналистов ${c.short}`, c.code, "bracket", R(2, 3));
    europe(`ek_res_${c.code}_finalists`, `Угадать обоих финалистов ${c.short}`, c.code, "bracket", R(2, 4));
    europe(`ek_res_${c.code}_champion`, `Угадать чемпиона ${c.short}`, c.code, "bracket", R(3, 6));
    europe(`ek_res_${c.code}_bracket_80`, `80+ очков за сетку ${c.short}`, c.code, "bracket", R(2, 2));
    europe(`ek_res_${c.code}_bracket_100`, `100+ очков за сетку ${c.short}`, c.code, "bracket", R(3, 4));
    // Total — results
    europe(`ek_res_${c.code}_total_150`, `150+ очков за ${c.short}`, c.code, "result", R(2, 2));
    europe(`ek_res_${c.code}_total_200`, `200+ очков за ${c.short}`, c.code, "result", R(3, 4));
  }

  // ── Eurocups · ties aggregates (STARTER defaults) ─────────────────────────────
  europe("ek_ties_fill_any", "Заполнить стыки любого еврокубка", "aggregate", "ties", R(1));
  europe("ek_ties_fill_all", "Заполнить стыки всех 3 еврокубков", "aggregate", "ties", R(3));
  europe("ek_ties_submit_any", "Подтвердить стыки любого еврокубка", "aggregate", "ties", R(2));
  europe("ek_ties_submit_all", "Подтвердить стыки всех 3 еврокубков", "aggregate", "ties", R(4));

  // ── Eurocups · bracket aggregates (STARTER defaults) ──────────────────────────
  europe("ek_bracket_fill_any", "Заполнить сетку любого еврокубка", "aggregate", "bracket", R(2));
  europe("ek_bracket_fill_all", "Заполнить сетки всех 3 еврокубков", "aggregate", "bracket", R(5));
  europe("ek_bracket_submit_any", "Подтвердить сетку любого еврокубка", "aggregate", "bracket", R(3));
  europe("ek_bracket_submit_all", "Подтвердить сетки всех 3 еврокубков", "aggregate", "bracket", R(6));
  europe("ek_bracket_champion_any", "Выбрать чемпиона любого еврокубка", "aggregate", "bracket", R(2));
  europe("ek_bracket_champion_all", "Выбрать чемпионов всех 3 еврокубков", "aggregate", "bracket", R(4));

  // ── Eurocups · result aggregates (badge "result" → Результаты) ────────────────
  europe("ek_res_ties_4_any", "4+ в стыках любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_ties_6_any", "6+ в стыках любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_ties_8_any", "8 из 8 в стыках любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_ties_4_all", "4+ в стыках всех 3 еврокубков", "aggregate", "result", R(3, 2));
  europe("ek_res_ties_6_two", "6+ в стыках двух еврокубков", "aggregate", "result", R(4, 3));
  europe("ek_res_champion_any", "Угадать чемпиона любого еврокубка", "aggregate", "result", R(3, 4));
  europe("ek_res_champion_2", "Угадать чемпионов 2 еврокубков", "aggregate", "result", R(5, 8));
  europe("ek_res_champion_3", "Угадать чемпионов всех 3 еврокубков", "aggregate", "result", R(0, 20, SEASON_TASK_REWARD_PREMIUM_CASE, 1));
  europe("ek_res_finalists_any", "Оба финалиста любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_finalists_2", "Оба финалиста в 2 еврокубках", "aggregate", "result", R(4, 6));
  europe("ek_res_semis_any", "Все 4 полуфиналиста любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_bracket_80_any", "80+ за сетку любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_bracket_100_any", "100+ за сетку любого еврокубка", "aggregate", "result", OFF);
  europe("ek_res_total_150_any", "150+ за любой еврокубок", "aggregate", "result", R(3, 2));
  europe("ek_res_total_200_any", "200+ за любой еврокубок", "aggregate", "result", R(4, 4));

  // ── «Золотой мяч» · только результаты (после церемонии) ───────────────────────
  // За само заполнение бюллетеня награды нет намеренно — иначе это раздача из
  // воздуха. Все пять — phase "result", по умолчанию ВЫКЛЮЧЕНЫ с подсказанной
  // ценой: админ включает и настраивает в панели.
  //
  // Тиры по местам вложены (топ-30 ⊃ топ-10 ⊃ топ-5) и растут вдвое, потому что
  // строгий порядок берётся несопоставимо труднее состава: топ-3 по именам —
  // достижимая цель, а все 30 по местам — плашка уровня «Угадать всю таблицу
  // точно» (top5_*_full_table), которая не выстрелит практически никогда.
  const ballonDor = (task_key: string, title: string, def: TaskRewardSpec) =>
    out.push({ task_key, title, category: "ballon_dor", tournament: "BALLON_DOR", phase: "result", default: def });

  // Заполнение — единственное «за действие». Оно честное только потому, что
  // лестница пустая: расставить 30 номинантов это настоящая работа, а не одно
  // нажатие по предзаполненному списку.
  out.push({
    task_key: "ballon_dor_fill", title: "Расставить всех номинантов",
    category: "ballon_dor", tournament: "BALLON_DOR", phase: "league", default: R(0, 2),
  });

  ballonDor("ballon_dor_winner", "Угадать обладателя Золотого мяча", ROFF(10));
  ballonDor("ballon_dor_top3_names", "Угадать топ-3 по именам", ROFF(15));
  ballonDor("ballon_dor_top5_exact", "Угадать топ-5 точно по местам", ROFF(30));
  ballonDor("ballon_dor_top10_exact", "Угадать топ-10 точно по местам", ROFF(60));
  ballonDor("ballon_dor_top30_exact", "Угадать все 30 мест точно", ROFF(150));

  // Пороги очков стоят МЕЖДУ вехами, а не на них: «75+ очков» было бы дословным
  // пересказом «угадать топ-5 точно» (ровно 75) и платило бы дважды за одно
  // событие. 30 и 50 лежат в реальном диапазоне борьбы (случайный бюллетень ~3,
  // сильный ~40).
  ballonDor("ballon_dor_points_30", "Набрать 30+ очков", ROFF(5));
  ballonDor("ballon_dor_points_50", "Набрать 50+ очков", ROFF(12));
  // Отдельная ось — точность по всей тридцатке. С бонусами не пересекается:
  // десять угаданных мест можно взять, не угадав ни обладателя, ни тройку.
  ballonDor("ballon_dor_exact_5", "Угадать 5+ мест", ROFF(6));
  ballonDor("ballon_dor_exact_10", "Угадать 10+ мест", ROFF(20));

  return out;
}

let _catalogCache: TaskRewardCatalogEntry[] | null = null;
let _catalogMapCache: Map<string, TaskRewardCatalogEntry> | null = null;
export function seasonTaskRewardCatalog(): TaskRewardCatalogEntry[] {
  if (!_catalogCache) _catalogCache = buildSeasonTaskRewardCatalog();
  return _catalogCache;
}
export function seasonTaskRewardCatalogMap(): Map<string, TaskRewardCatalogEntry> {
  if (!_catalogMapCache) _catalogMapCache = new Map(seasonTaskRewardCatalog().map((e) => [e.task_key, e]));
  return _catalogMapCache;
}
export function getTaskRewardCatalogEntry(taskKey: string): TaskRewardCatalogEntry | null {
  return seasonTaskRewardCatalogMap().get(taskKey) || null;
}

// ── Validation / normalization ──────────────────────────────────────────────
function toInt(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : 0;
}
function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

// Validate + normalize an admin reward config for a single task. Throws coded errors.
// Constraints (spec §3): balls/stars/case_count >= 0; case_type from a known set;
// when case_type is empty, case_count is forced to 0 (no orphan case counts).
export function validateTaskRewardConfigInput(
  taskKey: string,
  input: TaskRewardConfigInput,
  opts: { validCaseTypes: Set<string> },
): TaskRewardConfig {
  if (!getTaskRewardCatalogEntry(taskKey)) throw new Error("UNKNOWN_TASK_KEY");
  const balls = toInt(input.balls);
  const stars = toInt(input.stars);
  let case_count = toInt(input.case_count);
  const lucky_tokens = toInt(input.lucky_tokens);
  let boost_count = toInt(input.boost_count);
  if (balls < 0 || stars < 0 || case_count < 0 || lucky_tokens < 0 || boost_count < 0) throw new Error("REWARD_NEGATIVE");
  if (lucky_tokens > SEASON_TASK_LUCKY_TOKEN_MAX) throw new Error("REWARD_OVER_MAX");
  if (boost_count > SEASON_TASK_BOOST_MAX) throw new Error("REWARD_OVER_MAX");
  const case_type = input.case_type == null || input.case_type === "" ? null : String(input.case_type);
  if (case_type && !opts.validCaseTypes.has(case_type)) throw new Error("UNKNOWN_CASE_TYPE");
  if (!case_type) case_count = 0; // empty case type ⇒ count must be 0
  let boost_type = input.boost_type == null || input.boost_type === "" ? null : String(input.boost_type);
  if (boost_type && !(SEASON_TASK_ALLOWED_BOOST_TYPES as readonly string[]).includes(boost_type)) throw new Error("UNKNOWN_BOOST_TYPE");
  if (!boost_type) boost_count = 0;        // empty boost type ⇒ count must be 0
  if (boost_count === 0) boost_type = null; // zero count ⇒ no boost type
  return {
    task_key: taskKey,
    enabled: !!input.enabled,
    balls,
    stars,
    case_type,
    case_count,
    lucky_tokens,
    boost_type,
    boost_count,
    title_override: cleanText(input.title_override),
    admin_note: cleanText(input.admin_note),
  };
}

// ── Effective reward (stored config overrides the code default) ───────────────
export function effectiveTaskReward(stored: TaskRewardConfig | null, def: TaskRewardSpec): TaskRewardSpec {
  if (!stored) return { ...def };
  return {
    enabled: !!stored.enabled,
    balls: Math.max(0, toInt(stored.balls)),
    stars: Math.max(0, toInt(stored.stars)),
    case_type: stored.case_type || null,
    case_count: stored.case_type ? Math.max(0, toInt(stored.case_count)) : 0,
    lucky_tokens: Math.max(0, toInt(stored.lucky_tokens)),
    boost_type: stored.boost_type || null,
    boost_count: stored.boost_type ? Math.max(0, toInt(stored.boost_count)) : 0,
  };
}

// A reward is "active" (claimable-eligible) only when enabled AND it grants something.
export function rewardIsActive(reward: TaskRewardSpec): boolean {
  return !!reward.enabled && (reward.balls > 0 || reward.stars > 0 || (reward.case_count > 0 && !!reward.case_type) || (reward.lucky_tokens || 0) > 0 || ((reward.boost_count || 0) > 0 && !!reward.boost_type));
}

// User-facing reward payload — null when the task carries no active reward.
export function rewardForPayload(reward: TaskRewardSpec): TaskRewardPayload | null {
  if (!rewardIsActive(reward)) return null;
  return {
    stars: reward.stars,
    balls: reward.balls,
    case_type: reward.case_count > 0 ? reward.case_type : null,
    case_count: reward.case_count,
    lucky_tokens: reward.lucky_tokens || 0,
    boost_type: (reward.boost_count || 0) > 0 ? reward.boost_type : null,
    boost_count: reward.boost_count || 0,
  };
}

// ── Claim status / resolver ───────────────────────────────────────────────────
export function taskClaimStatus(taskStatus: SeasonTaskStatus, rewardActive: boolean, claimed: boolean): SeasonTaskClaimStatus {
  if (!rewardActive) return "not_claimable";
  if (claimed) return "claimed";
  if (taskStatus === "completed") return "claimable";
  return "not_claimable"; // future / failed / in_progress / available
}

export type ClaimResolution =
  | { ok: true; reward: TaskRewardPayload }
  | { ok: false; code: "NOT_CLAIMABLE" | "ALREADY_CLAIMED" | "NOT_COMPLETED" };

// Pure claim gate shared by the endpoint AND tests. Reward MUST be active, the task
// MUST be completed, and it MUST NOT have been claimed already. Disabled/zero reward
// or non-completed status → reject (never grants for future/failed/in_progress).
export function resolveTaskClaim(taskStatus: SeasonTaskStatus, reward: TaskRewardSpec, alreadyClaimed: boolean): ClaimResolution {
  if (!rewardIsActive(reward)) return { ok: false, code: "NOT_CLAIMABLE" };
  if (alreadyClaimed) return { ok: false, code: "ALREADY_CLAIMED" };
  if (taskStatus !== "completed") return { ok: false, code: "NOT_COMPLETED" };
  return { ok: true, reward: rewardForPayload(reward)! };
}

// ── Dedup key (spec §10) ──────────────────────────────────────────────────────
export function taskClaimUniqueKeyBase(seasonId: number, userId: number, taskKey: string): string {
  return `season_prediction_task_claim:${seasonId}:${userId}:${taskKey}`;
}
export const TASK_CLAIM_KEY_PREFIX = "season_prediction_task_claim:";
// Extract the task_key from a stored ledger unique_key (…:{taskKey}:{component}).
// task_keys contain no ":" so positional split is safe.
export function taskKeyFromClaimUniqueKey(uniqueKey: string): string | null {
  if (!uniqueKey.startsWith(TASK_CLAIM_KEY_PREFIX)) return null;
  const parts = uniqueKey.split(":");
  // [prefix, seasonId, userId, taskKey, component?]
  return parts.length >= 4 ? parts[3] : null;
}

// ── Seed defaults (spec §5/§7) ────────────────────────────────────────────────
// Which catalog task_keys are missing from the stored set (to INSERT). Never
// overwrites existing rows (admin edits win). Only seeds tasks that carry a
// non-disabled starter default (disabled defaults need no stored row).
export function computeSeedInserts(existingKeys: Set<string>, opts?: { includeDisabled?: boolean }): TaskRewardCatalogEntry[] {
  return seasonTaskRewardCatalog().filter((e) => {
    if (existingKeys.has(e.task_key)) return false;
    if (opts?.includeDisabled) return true;
    return rewardIsActive(e.default);
  });
}

// ── Claimable badge counting (spec §13) ───────────────────────────────────────
// Only completed, reward-bearing, not-yet-claimed tasks count.
export function countClaimableTasks(tasks: Array<{ status?: SeasonTaskStatus; claim_status?: SeasonTaskClaimStatus | null }>): number {
  return tasks.filter((t) => t.claim_status === "claimable").length;
}

// ── Granular claimable summary (E10.2b, spec §2/§7) ─────────────────────────────
// Flat maps keyed so the UI can show a per-level badge without parsing titles:
//   sections[sectionId]                       e.g. "europe" → 25
//   subsections[`${sectionId}:${subId}`]      e.g. "europe:UCL" → 8
//   phases[`${sectionId}:${subId}:${phase}`]  e.g. "europe:UCL:ties" → 3
// phase defaults to "league" when a task carries none (top-5 / league-stage).
export type ClaimableSummaryTask = {
  section: string;
  subsection: string;
  phase?: string | null;
  claim_status?: SeasonTaskClaimStatus | null;
};
export type SeasonTaskClaimableSummary = {
  total: number;
  sections: Record<string, number>;
  subsections: Record<string, number>;
  phases: Record<string, number>;
};

export function buildSeasonTaskClaimableSummary(tasks: ClaimableSummaryTask[]): SeasonTaskClaimableSummary {
  const summary: SeasonTaskClaimableSummary = { total: 0, sections: {}, subsections: {}, phases: {} };
  const bump = (bucket: Record<string, number>, key: string) => { bucket[key] = (bucket[key] || 0) + 1; };
  for (const t of tasks) {
    if (t.claim_status !== "claimable") continue;
    const phase = t.phase || "league";
    summary.total += 1;
    bump(summary.sections, t.section);
    bump(summary.subsections, `${t.section}:${t.subsection}`);
    bump(summary.phases, `${t.section}:${t.subsection}:${phase}`);
  }
  return summary;
}

// ── Theoretical max summary (spec §14) ────────────────────────────────────────
export type TaskRewardBucket = { enabled_count: number; balls: number; stars: number; cases: number; lucky_tokens: number };
export type TaskRewardGroup = "activity" | "result" | "aggregate";
export type TaskRewardMaxSummary = {
  enabled_count: number;
  max_balls: number;
  max_stars: number;
  max_cases: number;
  max_lucky_tokens: number;
  cases_by_type: Record<string, number>;
  // E10.3: breakdowns so the admin can balance per area.
  by_category: Record<SeasonTaskRewardCategory, TaskRewardBucket>;
  by_group: Record<TaskRewardGroup, TaskRewardBucket>;
};

function emptyBucket(): TaskRewardBucket { return { enabled_count: 0, balls: 0, stars: 0, cases: 0, lucky_tokens: 0 }; }

// Which balance "group" a task belongs to: cross-cup aggregates, per-tournament
// result (outcome) tasks, or per-tournament activity (fill/submit/pick) tasks.
export function taskRewardGroup(entry: TaskRewardCatalogEntry): TaskRewardGroup {
  if (entry.tournament === "aggregate") return "aggregate";
  if (entry.task_key.startsWith("ek_res_")) return "result";
  return "activity";
}

// Sum of every enabled, non-zero effective reward (one of each task completed once),
// split by category (top5/europe) and by group (activity/result/aggregate).
export function theoreticalMaxRewards(stored: Map<string, TaskRewardConfig>): TaskRewardMaxSummary {
  const summary: TaskRewardMaxSummary = {
    enabled_count: 0, max_balls: 0, max_stars: 0, max_cases: 0, max_lucky_tokens: 0, cases_by_type: {},
    by_category: { top5: emptyBucket(), europe: emptyBucket(), start: emptyBucket(), ballon_dor: emptyBucket() },
    by_group: { activity: emptyBucket(), result: emptyBucket(), aggregate: emptyBucket() },
  };
  const add = (b: TaskRewardBucket, eff: TaskRewardSpec) => {
    b.enabled_count += 1; b.balls += eff.balls; b.stars += eff.stars;
    if (eff.case_count > 0 && eff.case_type) b.cases += eff.case_count;
    b.lucky_tokens += eff.lucky_tokens || 0;
  };
  for (const entry of seasonTaskRewardCatalog()) {
    const eff = effectiveTaskReward(stored.get(entry.task_key) || null, entry.default);
    if (!rewardIsActive(eff)) continue;
    summary.enabled_count += 1;
    summary.max_balls += eff.balls;
    summary.max_stars += eff.stars;
    summary.max_lucky_tokens += eff.lucky_tokens || 0;
    if (eff.case_count > 0 && eff.case_type) {
      summary.max_cases += eff.case_count;
      summary.cases_by_type[eff.case_type] = (summary.cases_by_type[eff.case_type] || 0) + eff.case_count;
    }
    add(summary.by_category[entry.category], eff);
    add(summary.by_group[taskRewardGroup(entry)], eff);
  }
  return summary;
}

// ── Balance warnings (spec §2, soft — informational only, no auto-trim) ─────────
// Admin guard rails, not hard caps: they fire in the panel when a hand-tuned
// config drifts past the sanctioned balance. Raised for the league-stage result
// rewards (220⭐ + a Premium case) so the warning keeps meaning "someone went
// further than we agreed", not "the agreed defaults are loaded" (452⭐ today).
export const TASK_REWARD_WARN_LIMITS = { balls: 200, stars: 550, cases: 3 } as const;
export function buildTaskRewardWarnings(summary: TaskRewardMaxSummary): string[] {
  const warnings: string[] = [];
  if (summary.max_cases > TASK_REWARD_WARN_LIMITS.cases) {
    warnings.push(`Проверь баланс: включено больше ${TASK_REWARD_WARN_LIMITS.cases} кейсов (${summary.max_cases}).`);
  }
  if (summary.max_stars > TASK_REWARD_WARN_LIMITS.stars) {
    warnings.push(`Высокий максимум звёзд: ${summary.max_stars} (порог ${TASK_REWARD_WARN_LIMITS.stars}).`);
  }
  if (summary.max_balls > TASK_REWARD_WARN_LIMITS.balls) {
    warnings.push(`Высокий максимум мячиков: ${summary.max_balls} (порог ${TASK_REWARD_WARN_LIMITS.balls}).`);
  }
  return warnings;
}

// ── Active-task sort rank (spec §5) ─────────────────────────────────────────────
// Surface what the user can act on first: claimable → in_progress/available →
// completed(no claim) → claimed → future → failed. (Future is normally rendered in
// its own block; the rank keeps it ahead of failed if ever mixed in.)
export function seasonTaskSortRank(task: { status?: SeasonTaskStatus; claim_status?: SeasonTaskClaimStatus | null }): number {
  if (task.claim_status === "claimable") return 0;
  if (task.status === "in_progress" || task.status === "available") return 1;
  if (task.status === "completed" && task.claim_status !== "claimed") return 2;
  if (task.claim_status === "claimed") return 3;
  if (task.status === "future") return 4;
  return 5; // failed
}
