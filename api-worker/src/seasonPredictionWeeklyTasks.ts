// seasonPredictionWeeklyTasks.ts
// Pure builder for "Вызов недели" tasks + rewards (Stage W2). No I/O, no DB.
// Rewards are granted elsewhere via the shared reward_ledger (idempotent).
// This module only decides task status / progress / claimability.
//
// Idempotency key design (must NOT include score / rank / option / volatile fields):
//   per-challenge:  weekly_challenge_task:{challenge_id}:{task_key}:{user_id}
//   season/series:  weekly_challenge_task:season:{season_id}:{task_key}:{user_id}
// Multi-component rewards append a stable suffix: :stars | :balls | :case:{type}

export const WEEKLY_CHALLENGE_TASK_SOURCE_TYPE = "weekly_challenge_task";

export type WeeklyTaskReward = {
  stars: number;
  balls: number;
  case_type: string | null;
  case_count: number;
  // Жетоны (lucky_token). Optional for backward compatibility with old snapshots.
  lucky_tokens?: number;
  // Бусты (extra_joker / double_chance). Optional for backward compatibility with old snapshots.
  // Only granted by result tiers (validation rejects boosts on participation/bonus).
  boost_type?: string | null;
  boost_count?: number;
};

export type WeeklyTaskStatus = "future" | "waiting_results" | "void" | "in_progress" | "failed" | "completed" | "claimable" | "claimed";

export type WeeklyTaskScope = "current_weekly_challenge" | "season_weekly_challenge";

export type WeeklyTaskGroup = "activity" | "result" | "series";

export type WeeklyTaskKey =
  | "weekly_challenge_started"
  | "weekly_challenge_all_answered"
  | "weekly_challenge_submitted"
  | "weekly_challenge_score_3"
  | "weekly_challenge_participation"
  | "weekly_challenge_bonus"
  | "weekly_challenge_result";

export type WeeklyTaskDef = {
  key: WeeklyTaskKey;
  title: string;
  description: string;
  scope: WeeklyTaskScope;
  group: WeeklyTaskGroup;
  target: number;
  // null reward = informational/deferred task (never claimable on W2).
  reward: WeeklyTaskReward | null;
};

// Perfect-challenge rule: total == max AND max >= this many confirmed questions.
// Chosen over "max == 5 && total == 5" so weeks with one void question (max 4)
// still allow a perfect, but a heavily-voided week (max < 4) does not trivialise it.
export const WEEKLY_PERFECT_MIN_MAX = 4;

export const SUBMITTED_ENTRY_STATUSES = new Set(["submitted", "locked", "scoring", "completed"]);

export const WEEKLY_CHALLENGE_TASK_SCHEMA_V2 = 2;

export type WeeklyBonusQuestionKey = "match" | "league" | "duel" | "upset" | "event";

const WEEKLY_BONUS_TO_FULL_KEY: Record<WeeklyBonusQuestionKey, string> = {
  match: "match_of_week",
  league: "league_of_week",
  duel: "duel_of_week",
  upset: "upset_of_week",
  event: "event_of_week",
};

const WEEKLY_FULL_TO_BONUS_KEY: Record<string, WeeklyBonusQuestionKey> = {
  match_of_week: "match",
  league_of_week: "league",
  duel_of_week: "duel",
  upset_of_week: "upset",
  event_of_week: "event",
};

// Bonus reward defaults now live in WEEKLY_TASK_REWARDS_DEFAULTS.bonus (single source of truth).

const WEEKLY_BONUS_TITLE: Record<WeeklyBonusQuestionKey, string> = {
  match: "Бонус: матч недели",
  league: "Бонус: лига недели",
  duel: "Бонус: дуэль недели",
  upset: "Бонус: сенсация недели",
  event: "Бонус: событие недели",
};

const WEEKLY_BONUS_DESCRIPTION: Record<WeeklyBonusQuestionKey, string> = {
  match: "Награда откроется, если ответ на матч недели верный после финального подсчёта.",
  league: "Награда откроется, если ответ на лигу недели верный после финального подсчёта.",
  duel: "Награда откроется, если ответ на дуэль недели верный после финального подсчёта.",
  upset: "Награда откроется, если ответ на сенсацию недели верный после финального подсчёта.",
  event: "Награда откроется, если ответ на событие недели верный после финального подсчёта.",
};

export function normalizeWeeklyBonusQuestionKey(value: unknown): WeeklyBonusQuestionKey | null {
  const key = String(value ?? "").trim();
  if (!key) return null;
  if (key in WEEKLY_BONUS_TO_FULL_KEY) return key as WeeklyBonusQuestionKey;
  return WEEKLY_FULL_TO_BONUS_KEY[key] || null;
}

export function weeklyBonusQuestionFullKey(value: unknown): string | null {
  const key = normalizeWeeklyBonusQuestionKey(value);
  return key ? WEEKLY_BONUS_TO_FULL_KEY[key] : null;
}

// ── Editable per-challenge task rewards (V2 only) ────────────────────────────
// Stored in season_prediction_weekly_challenges.settings_json.weekly_task_rewards.
// Single source of truth for defaults + limits; V1 rewards stay the hardcoded catalog.

export type WeeklyRewardComponent = { stars: number; balls: number; case_type: string | null; case_count: number; lucky_tokens: number; boost_type: string | null; boost_count: number };
// The weekly system's own default case + the canonical season case types. The full
// allowed set (incl. active shop_cases) is resolved at the endpoint and passed to validate.
export const WEEKLY_DEFAULT_CASE_TYPE = "basic";
export const WEEKLY_BUILTIN_CASE_TYPES = ["basic", "premium", "daily_free"];
// Boost reward support (result tiers only). Fixed set — mirrors the paid boosts stored
// in user_boosts. Boosts are granted one row per unit (status='available').
export const WEEKLY_ALLOWED_BOOST_TYPES = ["extra_joker", "double_chance"] as const;
export const WEEKLY_DEFAULT_BOOST_TYPE = "extra_joker";
export type WeeklyBonusFullKey = "match_of_week" | "league_of_week" | "duel_of_week" | "upset_of_week" | "event_of_week";
export type WeeklyResultTier = "start" | "bronze" | "silver" | "gold" | "perfect";
export type WeeklyTaskRewardsConfig = {
  version: number;
  participation: WeeklyRewardComponent;
  bonus: Record<WeeklyBonusFullKey, WeeklyRewardComponent>;
  result: Record<WeeklyResultTier, WeeklyRewardComponent>;
};

export const WEEKLY_TASK_REWARDS_VERSION = 1;
export const WEEKLY_REWARD_LIMITS = {
  stars: { min: 0, max: 50 },
  balls: { min: 0, max: 20 },
  case_count: { min: 0, max: 5 },
  lucky_tokens: { min: 0, max: 10 },
  boost_count: { min: 0, max: 5 },
} as const;
export const WEEKLY_BONUS_FULL_KEYS: WeeklyBonusFullKey[] = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"];
export const WEEKLY_RESULT_TIERS: WeeklyResultTier[] = ["start", "bronze", "silver", "gold", "perfect"];

function rc(stars: number, balls = 0, caseType: string | null = null, caseCount = 0, luckyTokens = 0, boostType: string | null = null, boostCount = 0): WeeklyRewardComponent {
  return {
    stars,
    balls,
    case_type: caseCount > 0 ? (caseType || WEEKLY_DEFAULT_CASE_TYPE) : null,
    case_count: caseCount,
    lucky_tokens: luckyTokens,
    boost_type: boostCount > 0 ? (boostType || WEEKLY_DEFAULT_BOOST_TYPE) : null,
    boost_count: boostCount,
  };
}

export const WEEKLY_TASK_REWARDS_DEFAULTS: WeeklyTaskRewardsConfig = {
  version: WEEKLY_TASK_REWARDS_VERSION,
  participation: rc(2),
  // Every bonus question defaults to 2⭐ — the admin picks WHICH question is the bonus each week; its value is uniform.
  bonus: { match_of_week: rc(2), league_of_week: rc(2), duel_of_week: rc(2), upset_of_week: rc(2), event_of_week: rc(2) },
  result: { start: rc(1, 0, null, 0, 0, "double_chance", 1), bronze: rc(1), silver: rc(2), gold: rc(3, 1), perfect: rc(5, 0, "basic", 1) },
};

export function cloneWeeklyTaskRewardsDefaults(): WeeklyTaskRewardsConfig {
  return JSON.parse(JSON.stringify(WEEKLY_TASK_REWARDS_DEFAULTS));
}

function clampComponentField(value: unknown, limit: { min: number; max: number }): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return limit.min;
  return Math.max(limit.min, Math.min(limit.max, Math.floor(n)));
}

// Lenient normalize (read path): missing/NaN/decimal/out-of-range coerced to safe ints.
// case_count reads case_count (or legacy basic_cases); case_type defaults to "basic" when count>0.
export function normalizeWeeklyRewardComponent(raw: unknown): WeeklyRewardComponent {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const count = clampComponentField(o.case_count ?? o.basic_cases, WEEKLY_REWARD_LIMITS.case_count);
  const rawType = o.case_type == null ? "" : String(o.case_type).trim();
  const boostCount = clampComponentField(o.boost_count, WEEKLY_REWARD_LIMITS.boost_count);
  const rawBoostType = o.boost_type == null ? "" : String(o.boost_type).trim();
  const boostTypeValid = (WEEKLY_ALLOWED_BOOST_TYPES as readonly string[]).includes(rawBoostType);
  return {
    stars: clampComponentField(o.stars, WEEKLY_REWARD_LIMITS.stars),
    balls: clampComponentField(o.balls, WEEKLY_REWARD_LIMITS.balls),
    case_type: count > 0 ? (rawType || WEEKLY_DEFAULT_CASE_TYPE) : null,
    case_count: count,
    lucky_tokens: clampComponentField(o.lucky_tokens, WEEKLY_REWARD_LIMITS.lucky_tokens),
    boost_type: boostCount > 0 ? (boostTypeValid ? rawBoostType : WEEKLY_DEFAULT_BOOST_TYPE) : null,
    boost_count: boostCount,
  };
}

export function weeklyRewardComponentIsEmpty(c: WeeklyRewardComponent): boolean {
  return c.stars <= 0 && c.balls <= 0 && c.case_count <= 0 && (c.lucky_tokens || 0) <= 0 && (c.boost_count || 0) <= 0;
}

// Lenient parse of a full config (read path). Missing keys → defaults; never throws.
export function normalizeWeeklyTaskRewardsConfig(raw: unknown): WeeklyTaskRewardsConfig {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const bonusRaw = (o.bonus && typeof o.bonus === "object") ? (o.bonus as Record<string, unknown>) : {};
  const resultRaw = (o.result && typeof o.result === "object") ? (o.result as Record<string, unknown>) : {};
  const bonus = {} as Record<WeeklyBonusFullKey, WeeklyRewardComponent>;
  for (const k of WEEKLY_BONUS_FULL_KEYS) bonus[k] = normalizeWeeklyRewardComponent(bonusRaw[k] ?? WEEKLY_TASK_REWARDS_DEFAULTS.bonus[k]);
  const result = {} as Record<WeeklyResultTier, WeeklyRewardComponent>;
  for (const t of WEEKLY_RESULT_TIERS) result[t] = normalizeWeeklyRewardComponent(resultRaw[t] ?? WEEKLY_TASK_REWARDS_DEFAULTS.result[t]);
  return {
    version: WEEKLY_TASK_REWARDS_VERSION,
    participation: normalizeWeeklyRewardComponent(o.participation ?? WEEKLY_TASK_REWARDS_DEFAULTS.participation),
    bonus,
    result,
  };
}

// Safe read from settings_json: returns config + source. Malformed → defaults (never throws).
export function parseWeeklyTaskRewardsFromSettings(settings: unknown): { config: WeeklyTaskRewardsConfig; source: "default" | "custom"; malformed: boolean } {
  const s = (settings && typeof settings === "object" && !Array.isArray(settings)) ? (settings as Record<string, unknown>) : {};
  const raw = s.weekly_task_rewards;
  if (raw == null) return { config: cloneWeeklyTaskRewardsDefaults(), source: "default", malformed: false };
  if (typeof raw !== "object" || Array.isArray(raw)) return { config: cloneWeeklyTaskRewardsDefaults(), source: "default", malformed: true };
  try {
    return { config: normalizeWeeklyTaskRewardsConfig(raw), source: "custom", malformed: false };
  } catch {
    return { config: cloneWeeklyTaskRewardsDefaults(), source: "default", malformed: true };
  }
}

// Strict validate (write/PUT path). Throws coded errors on negative/decimal/over-max/empty/
// unknown-case-type. allowedCaseTypes (when provided) restricts case_type to the live set.
function validateStrictComponent(raw: unknown, where: string, allowedCaseTypes?: Set<string>, allowBoost = false): WeeklyRewardComponent {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const field = (name: "stars" | "balls" | "case_count" | "lucky_tokens" | "boost_count", legacyKey?: string) => {
    const v = o[name] ?? (legacyKey ? o[legacyKey] : undefined);
    if (v == null || v === "") return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`WEEKLY_REWARD_INVALID_NUMBER:${where}.${name}`);
    if (n < WEEKLY_REWARD_LIMITS[name].min) throw new Error(`WEEKLY_REWARD_NEGATIVE:${where}.${name}`);
    if (n > WEEKLY_REWARD_LIMITS[name].max) throw new Error(`WEEKLY_REWARD_OVER_MAX:${where}.${name}`);
    return n;
  };
  const stars = field("stars");
  const balls = field("balls");
  const caseCount = field("case_count", "basic_cases");
  const luckyTokens = field("lucky_tokens");
  const boostCount = field("boost_count");
  let caseType: string | null = null;
  if (caseCount > 0) {
    caseType = (o.case_type == null ? "" : String(o.case_type).trim()) || WEEKLY_DEFAULT_CASE_TYPE;
    if (allowedCaseTypes && !allowedCaseTypes.has(caseType)) throw new Error(`WEEKLY_REWARD_INVALID_CASE_TYPE:${where}:${caseType}`);
  }
  let boostType: string | null = null;
  if (boostCount > 0) {
    // Boosts are a result-tier-only reward; reject them everywhere else.
    if (!allowBoost) throw new Error(`WEEKLY_REWARD_BOOST_NOT_ALLOWED:${where}`);
    boostType = (o.boost_type == null ? "" : String(o.boost_type).trim()) || WEEKLY_DEFAULT_BOOST_TYPE;
    if (!(WEEKLY_ALLOWED_BOOST_TYPES as readonly string[]).includes(boostType)) throw new Error(`WEEKLY_REWARD_INVALID_BOOST_TYPE:${where}:${boostType}`);
  }
  return { stars, balls, case_type: caseType, case_count: caseCount, lucky_tokens: luckyTokens, boost_type: boostType, boost_count: boostCount };
}

// Validate a full PUT payload. Empty reward (all zero) is rejected for every task.
export function validateWeeklyTaskRewardsInput(raw: unknown, allowedCaseTypes?: Set<string>): WeeklyTaskRewardsConfig {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const bonusRaw = (o.bonus && typeof o.bonus === "object") ? (o.bonus as Record<string, unknown>) : {};
  const resultRaw = (o.result && typeof o.result === "object") ? (o.result as Record<string, unknown>) : {};
  // Boosts are allowed ONLY on result tiers (allowBoost=true); participation/bonus reject them.
  const participation = validateStrictComponent(o.participation, "participation", allowedCaseTypes, false);
  if (weeklyRewardComponentIsEmpty(participation)) throw new Error("WEEKLY_REWARD_EMPTY:participation");
  const bonus = {} as Record<WeeklyBonusFullKey, WeeklyRewardComponent>;
  for (const k of WEEKLY_BONUS_FULL_KEYS) {
    const c = validateStrictComponent(bonusRaw[k], `bonus.${k}`, allowedCaseTypes, false);
    if (weeklyRewardComponentIsEmpty(c)) throw new Error(`WEEKLY_REWARD_EMPTY:bonus.${k}`);
    bonus[k] = c;
  }
  const result = {} as Record<WeeklyResultTier, WeeklyRewardComponent>;
  for (const t of WEEKLY_RESULT_TIERS) {
    const c = validateStrictComponent(resultRaw[t], `result.${t}`, allowedCaseTypes, true);
    if (weeklyRewardComponentIsEmpty(c)) throw new Error(`WEEKLY_REWARD_EMPTY:result.${t}`);
    result[t] = c;
  }
  return { version: WEEKLY_TASK_REWARDS_VERSION, participation, bonus, result };
}

// Convert a config component to the runtime WeeklyTaskReward (1:1 — same shape).
export function weeklyRewardComponentToReward(c: WeeklyRewardComponent): WeeklyTaskReward {
  return {
    stars: c.stars,
    balls: c.balls,
    case_type: c.case_count > 0 ? (c.case_type || WEEKLY_DEFAULT_CASE_TYPE) : null,
    case_count: c.case_count,
    lucky_tokens: c.lucky_tokens || 0,
    boost_type: (c.boost_count || 0) > 0 ? (c.boost_type || WEEKLY_DEFAULT_BOOST_TYPE) : null,
    boost_count: c.boost_count || 0,
  };
}

export type WeeklyMaxReward = { stars: number; balls: number; cases: Record<string, number>; lucky_tokens: number; boosts: Record<string, number> };

// Max possible reward for the week = participation + selected bonus + perfect tier.
// Result tiers do NOT stack — only the best achieved tier is granted (use perfect for max).
// Cases are aggregated by type (different tasks may grant different case types).
export function weeklyMaxRewardSummary(config: WeeklyTaskRewardsConfig, bonusKey: unknown): WeeklyMaxReward {
  const fullKey = weeklyBonusQuestionFullKey(bonusKey);
  const parts = [config.participation, fullKey ? config.bonus[fullKey as WeeklyBonusFullKey] : null, config.result.perfect].filter(Boolean) as WeeklyRewardComponent[];
  const cases: Record<string, number> = {};
  const boosts: Record<string, number> = {};
  let stars = 0; let balls = 0; let luckyTokens = 0;
  for (const p of parts) {
    stars += p.stars || 0;
    balls += p.balls || 0;
    luckyTokens += p.lucky_tokens || 0;
    if (p.case_count > 0 && p.case_type) cases[p.case_type] = (cases[p.case_type] || 0) + p.case_count;
    if ((p.boost_count || 0) > 0 && p.boost_type) boosts[p.boost_type] = (boosts[p.boost_type] || 0) + p.boost_count;
  }
  return { stars, balls, cases, lucky_tokens: luckyTokens, boosts };
}

export function normalizeWeeklyTaskSchemaVersion(value: unknown): 1 | 2 {
  return Number(value || 1) >= WEEKLY_CHALLENGE_TASK_SCHEMA_V2 ? 2 : 1;
}

export function assertWeeklyTaskConfigChangeAllowed(input: {
  currentStatus: string;
  currentTaskSchemaVersion: number | null | undefined;
  currentBonusQuestionKey: unknown;
  requestedTaskSchemaVersion: number | null | undefined;
  requestedBonusQuestionKey: unknown;
  entryCount: number;
}) {
  const currentVersion = normalizeWeeklyTaskSchemaVersion(input.currentTaskSchemaVersion);
  const requestedVersion = normalizeWeeklyTaskSchemaVersion(input.requestedTaskSchemaVersion);
  const currentBonus = currentVersion >= WEEKLY_CHALLENGE_TASK_SCHEMA_V2
    ? normalizeWeeklyBonusQuestionKey(input.currentBonusQuestionKey)
    : null;
  const requestedBonus = requestedVersion >= WEEKLY_CHALLENGE_TASK_SCHEMA_V2
    ? normalizeWeeklyBonusQuestionKey(input.requestedBonusQuestionKey)
    : null;
  if (requestedVersion >= WEEKLY_CHALLENGE_TASK_SCHEMA_V2 && !requestedBonus) {
    throw new Error("WEEKLY_V2_BONUS_QUESTION_REQUIRED");
  }
  const changed = requestedVersion !== currentVersion || requestedBonus !== currentBonus;
  if (changed && (String(input.currentStatus) !== "draft" || Number(input.entryCount || 0) > 0)) {
    throw new Error("WEEKLY_TASK_SCHEMA_LOCKED_AFTER_ENTRIES_OR_PUBLISH");
  }
  return { task_schema_version: requestedVersion, bonus_question_key: requestedBonus };
}

export const WEEKLY_V2_TASK_KEYS: WeeklyTaskKey[] = [
  "weekly_challenge_participation",
  "weekly_challenge_bonus",
  "weekly_challenge_result",
];

export type WeeklyTaskBuilderInput = {
  userId: number;
  seasonId: number;
  challenge: { id: number; title: string; status: string; deadline_at?: number | null; task_schema_version?: number | null; bonus_question_key?: string | null } | null;
  entry: { status: string; answers: Record<string, unknown>; submitted_at?: number | null } | null;
  // Active non-void question keys for the current challenge (for all_answered).
  activeQuestionKeys: string[];
  score: { total_points: number; max_possible_points: number; correct_answers: number } | null;
  questionResults?: Record<string, { status: "correct" | "wrong" | "void" | "unanswered" | "pending_official"; points: number; title?: string | null }>;
  // W4/W5: official answers changed after the last recalc → the score is not final,
  // so result tasks must NOT become claimable on a stale score.
  resultsStale?: boolean;
  // Season aggregate for series tasks (informational only on W2).
  seasonSubmittedCount: number;
  // Raw unique_keys already present in reward_ledger for this user (prefix-matched).
  claimedUniqueKeys: string[];
  // Completed claim operation snapshots, keyed by weeklyTaskUniqueKeyBase().
  claimedTaskSnapshots?: Record<string, { reward?: WeeklyTaskReward | null; tier?: string | null; task_schema_version?: number | null; component_keys?: string[] }>;
  // Per-challenge editable reward config (V2). Absent → hardcoded defaults.
  rewardConfig?: WeeklyTaskRewardsConfig;
};

type WeeklyClaimedTaskSnapshot = NonNullable<WeeklyTaskBuilderInput["claimedTaskSnapshots"]>[string];

export type WeeklyTaskView = {
  key: string;
  title: string;
  description: string;
  scope: WeeklyTaskScope;
  group: WeeklyTaskGroup;
  status: WeeklyTaskStatus;
  progress: { current: number; target: number };
  reward: WeeklyTaskReward | null;
  claimable: boolean;
  claimed: boolean;
  // W5: deferred tasks (series, no reward yet) are hidden from the user UI so they
  // never read as an unreachable goal.
  deferred: boolean;
  future_reason?: string;
  steps?: Array<{ key: string; title: string; completed: boolean }>;
  meta?: Record<string, unknown>;
};

// Stable, score/rank-independent idempotency base for a task's reward.
export function weeklyTaskUniqueKeyBase(
  def: Pick<WeeklyTaskDef, "key" | "scope">,
  ctx: { challengeId: number | null; seasonId: number; userId: number },
): string | null {
  if (def.scope === "season_weekly_challenge") {
    return `weekly_challenge_task:season:${ctx.seasonId}:${def.key}:${ctx.userId}`;
  }
  if (ctx.challengeId == null) return null;
  return `weekly_challenge_task:${ctx.challengeId}:${def.key}:${ctx.userId}`;
}

export function weeklyRewardComponentKeys(base: string, reward: WeeklyTaskReward | null): string[] {
  if (!reward) return [];
  const keys: string[] = [];
  if (reward.stars > 0) keys.push(`${base}:stars`);
  if (reward.balls > 0) keys.push(`${base}:balls`);
  if (reward.case_count > 0 && reward.case_type) keys.push(`${base}:case:${reward.case_type}`);
  if ((reward.lucky_tokens || 0) > 0) keys.push(`${base}:lucky_token`);
  if ((reward.boost_count || 0) > 0 && reward.boost_type) keys.push(`${base}:boost:${reward.boost_type}`);
  return keys;
}

export function weeklyRewardComponentsComplete(base: string | null, reward: WeeklyTaskReward | null, claimedUniqueKeys: string[]): boolean {
  if (!base || !reward) return false;
  const required = weeklyRewardComponentKeys(base, reward);
  if (required.length === 0) return false;
  const keys = new Set(claimedUniqueKeys);
  return required.every((key) => keys.has(key));
}

function isFreshScore(input: WeeklyTaskBuilderInput): boolean {
  return !!input.score && !input.resultsStale;
}

function answeredCount(input: WeeklyTaskBuilderInput): number {
  const keys = input.activeQuestionKeys || [];
  const answers = (input.entry?.answers && typeof input.entry.answers === "object") ? input.entry.answers : {};
  return keys.filter((k) => {
    const v = (answers as Record<string, unknown>)[k];
    return v != null && v !== "";
  }).length;
}

function isSubmittedBeforeDeadline(input: WeeklyTaskBuilderInput): boolean {
  const entry = input.entry;
  if (!entry || !SUBMITTED_ENTRY_STATUSES.has(String(entry.status))) return false;
  const deadline = input.challenge?.deadline_at == null ? null : Number(input.challenge.deadline_at);
  const submittedAt = entry.submitted_at == null ? null : Number(entry.submitted_at);
  if (deadline != null && Number.isFinite(deadline) && submittedAt != null && Number.isFinite(submittedAt)) {
    return submittedAt <= deadline;
  }
  return true;
}

type WeeklyV2Tier = "start" | "bronze" | "silver" | "gold" | "perfect";

// Tier thresholds are UNCHANGED; only the reward amount comes from the resolved config.
function weeklyV2Tier(score: WeeklyTaskBuilderInput["score"], resultConfig: WeeklyTaskRewardsConfig["result"]): { tier: WeeklyV2Tier | null; reward: WeeklyTaskReward | null; pct: number } {
  const total = Number(score?.total_points || 0);
  const max = Number(score?.max_possible_points || 0);
  if (max <= 0) return { tier: null, reward: null, pct: 0 };
  const pct = total / max;
  const r = (t: WeeklyV2Tier) => weeklyRewardComponentToReward(resultConfig[t]);
  if (max >= WEEKLY_PERFECT_MIN_MAX && total === max) return { tier: "perfect", reward: r("perfect"), pct };
  if (pct >= 0.8) return { tier: "gold", reward: r("gold"), pct };
  if (pct >= 0.6) return { tier: "silver", reward: r("silver"), pct };
  if (pct >= 0.4) return { tier: "bronze", reward: r("bronze"), pct };
  // Нижний тир: хотя бы один верный ответ (1/5 = 0.2). Ниже порога награды нет.
  if (pct >= 0.2) return { tier: "start", reward: r("start"), pct };
  return { tier: null, reward: null, pct };
}

function markClaimState(def: Pick<WeeklyTaskDef, "key" | "scope">, rewardValue: WeeklyTaskReward | null, input: WeeklyTaskBuilderInput, done: boolean, fallbackStatus: WeeklyTaskStatus): Pick<WeeklyTaskView, "status" | "claimable" | "claimed"> {
  const hasReward = !!rewardValue && (rewardValue.stars > 0 || rewardValue.balls > 0 || rewardValue.case_count > 0 || (rewardValue.lucky_tokens || 0) > 0);
  if (!done || !hasReward) return { status: fallbackStatus, claimable: false, claimed: false };
  const base = weeklyTaskUniqueKeyBase(def, {
    challengeId: input.challenge ? Number(input.challenge.id) : null,
    seasonId: input.seasonId,
    userId: input.userId,
  });
  const claimed = weeklyRewardComponentsComplete(base, rewardValue, input.claimedUniqueKeys);
  return claimed
    ? { status: "claimed", claimable: false, claimed: true }
    : { status: "claimable", claimable: true, claimed: false };
}

function snapshotForTask(def: Pick<WeeklyTaskDef, "key" | "scope">, input: WeeklyTaskBuilderInput): { base: string | null; snapshot: WeeklyClaimedTaskSnapshot | null } {
  const base = weeklyTaskUniqueKeyBase(def, {
    challengeId: input.challenge ? Number(input.challenge.id) : null,
    seasonId: input.seasonId,
    userId: input.userId,
  });
  if (!base) return { base: null, snapshot: null };
  return { base, snapshot: input.claimedTaskSnapshots?.[base] || null };
}

function buildWeeklyChallengeTasksV2ForUser(input: WeeklyTaskBuilderInput): WeeklyTaskView[] {
  const noChallenge = !input.challenge;
  const rewardConfig = input.rewardConfig || WEEKLY_TASK_REWARDS_DEFAULTS;
  const activeTarget = Math.max(0, input.activeQuestionKeys.length);
  const answered = answeredCount(input);
  const started = !!input.entry;
  const allAnswered = activeTarget > 0 && answered >= activeTarget;
  const submitted = isSubmittedBeforeDeadline(input);
  const steps = [
    { key: "started", title: "Начат", completed: started },
    { key: "answered", title: "5 ответов", completed: allAnswered },
    { key: "submitted", title: "Подтверждён", completed: submitted },
  ];

  const participationReward = weeklyRewardComponentToReward(rewardConfig.participation);
  const participationDef = { key: "weekly_challenge_participation" as WeeklyTaskKey, scope: "current_weekly_challenge" as WeeklyTaskScope };
  const participationSnapshot = snapshotForTask(participationDef, input).snapshot;
  const participationDone = !noChallenge && started && allAnswered && submitted;
  const participationState = noChallenge
    ? { status: "future" as WeeklyTaskStatus, claimable: false, claimed: false }
    : participationSnapshot
      ? { status: "claimed" as WeeklyTaskStatus, claimable: false, claimed: true }
      : markClaimState(participationDef, participationReward, input, participationDone, "in_progress");
  const participation: WeeklyTaskView = {
    key: "weekly_challenge_participation",
    title: "Заверши Вызов недели",
    description: "Начни, ответь на все активные вопросы и подтверди до дедлайна.",
    scope: "current_weekly_challenge",
    group: "activity",
    status: participationState.status,
    progress: { current: steps.filter((s) => s.completed).length, target: steps.length },
    reward: participationReward,
    claimable: participationState.claimable,
    claimed: participationState.claimed,
    deferred: false,
    steps,
  };
  if (noChallenge) participation.future_reason = "Нет доступного Вызова недели";

  const bonusKey = normalizeWeeklyBonusQuestionKey(input.challenge?.bonus_question_key);
  const bonusFullKey = weeklyBonusQuestionFullKey(bonusKey);
  const bonusReward = bonusFullKey ? weeklyRewardComponentToReward(rewardConfig.bonus[bonusFullKey as WeeklyBonusFullKey]) : null;
  const bonusDef = { key: "weekly_challenge_bonus" as WeeklyTaskKey, scope: "current_weekly_challenge" as WeeklyTaskScope };
  const bonusSnapshot = snapshotForTask(bonusDef, input).snapshot;
  const bonusQuestion = bonusFullKey ? input.questionResults?.[bonusFullKey] : null;
  let bonusStatus: WeeklyTaskStatus = "in_progress";
  let bonusClaimable = false;
  let bonusClaimed = false;
  let bonusFutureReason: string | undefined;
  if (noChallenge || !bonusKey || !bonusFullKey) {
    bonusStatus = "future";
    bonusFutureReason = "Бонусный вопрос не настроен";
  } else if (bonusSnapshot) {
    bonusStatus = "claimed";
    bonusClaimed = true;
  } else if (!submitted) {
    bonusStatus = "in_progress";
  } else if (!isFreshScore(input) || !bonusQuestion || bonusQuestion.status === "pending_official") {
    bonusStatus = "waiting_results";
    bonusFutureReason = "Ждём финальный подсчёт";
  } else if (bonusQuestion.status === "void") {
    bonusStatus = "void";
  } else if (bonusQuestion.status === "correct") {
    const state = markClaimState(bonusDef, bonusReward, input, true, "completed");
    bonusStatus = state.status;
    bonusClaimable = state.claimable;
    bonusClaimed = state.claimed;
  } else {
    bonusStatus = "failed";
  }
  const bonus: WeeklyTaskView = {
    key: "weekly_challenge_bonus",
    title: bonusKey ? WEEKLY_BONUS_TITLE[bonusKey] : "Бонусный вопрос",
    description: bonusKey ? WEEKLY_BONUS_DESCRIPTION[bonusKey] : "Выберите бонусный вопрос в настройках админки.",
    scope: "current_weekly_challenge",
    group: "result",
    status: bonusStatus,
    progress: { current: bonusStatus === "claimable" || bonusStatus === "claimed" || bonusStatus === "completed" ? 1 : 0, target: 1 },
    reward: bonusSnapshot?.reward || bonusReward,
    claimable: bonusClaimable,
    claimed: bonusClaimed,
    deferred: false,
    meta: { bonus_question_key: bonusKey, question_key: bonusFullKey, question_status: bonusQuestion?.status || null },
  };
  if (bonusFutureReason) bonus.future_reason = bonusFutureReason;

  const resultDef = { key: "weekly_challenge_result" as WeeklyTaskKey, scope: "current_weekly_challenge" as WeeklyTaskScope };
  const resultSnapshot = snapshotForTask(resultDef, input).snapshot;
  const tier = weeklyV2Tier(input.score, rewardConfig.result);
  let resultStatus: WeeklyTaskStatus = "waiting_results";
  let resultClaimable = false;
  let resultClaimed = false;
  let resultFutureReason: string | undefined;
  if (resultSnapshot) {
    resultStatus = "claimed";
    resultClaimed = true;
  } else if (noChallenge) {
    resultStatus = "future";
    resultFutureReason = "Нет доступного Вызова недели";
  } else if (!submitted) {
    resultStatus = "in_progress";
  } else if (!isFreshScore(input)) {
    resultStatus = "waiting_results";
    resultFutureReason = "Ждём финальный подсчёт";
  } else if (!tier.tier || !tier.reward) {
    resultStatus = "failed";
  } else {
    const state = markClaimState(resultDef, tier.reward, input, true, "completed");
    resultStatus = state.status;
    resultClaimable = state.claimable;
    resultClaimed = state.claimed;
  }
  const max = Number(input.score?.max_possible_points || 0);
  const total = Number(input.score?.total_points || 0);
  const result: WeeklyTaskView = {
    key: "weekly_challenge_result",
    title: "Итог недели",
    description: "После подсчёта можно забрать только лучшую достигнутую награду.",
    scope: "current_weekly_challenge",
    group: "result",
    status: resultStatus,
    progress: { current: Math.max(0, total), target: Math.max(1, max) },
    reward: resultSnapshot?.reward || tier.reward,
    claimable: resultClaimable,
    claimed: resultClaimed,
    deferred: false,
    meta: { tier: resultSnapshot?.tier || tier.tier, pct: tier.pct, max_possible_points: max },
  };
  if (resultFutureReason) result.future_reason = resultFutureReason;

  return [participation, bonus, result];
}

export function buildWeeklyChallengeTasksForUser(input: WeeklyTaskBuilderInput): WeeklyTaskView[] {
  // V1 task schema is retired: every challenge now uses the V2 task set.
  return buildWeeklyChallengeTasksV2ForUser(input);
}

// Resolve a single task definition + its computed view for a claim request.
export function resolveWeeklyTaskForClaim(
  taskKey: string,
  input: WeeklyTaskBuilderInput,
): { def: WeeklyTaskDef; view: WeeklyTaskView; base: string } | null {
  const views = buildWeeklyChallengeTasksForUser(input);
  const view = views.find((v) => v.key === taskKey);
  if (!view) return null;
  const def: WeeklyTaskDef = {
    key: view.key as WeeklyTaskKey,
    title: view.title,
    description: view.description,
    scope: view.scope,
    group: view.group,
    target: view.progress.target,
    reward: view.reward,
  };
  const base = weeklyTaskUniqueKeyBase(def, {
    challengeId: input.challenge ? Number(input.challenge.id) : null,
    seasonId: input.seasonId,
    userId: input.userId,
  });
  if (!base) return null;
  return { def, view, base };
}
