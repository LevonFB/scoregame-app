// Stage R1 — pure helpers for season-prediction rating rewards.
// No I/O, no DB, no economy writes. Validation + rank→rule matching + defaults.
// Actual granting happens in index.ts via the shared idempotent reward_ledger.

export const SEASON_REWARD_SCOPES = ["season_overall", "top5_overall", "eurocups_overall"] as const;
export type SeasonRewardScope = (typeof SEASON_REWARD_SCOPES)[number];

export function isSeasonRewardScope(value: unknown): value is SeasonRewardScope {
  return typeof value === "string" && (SEASON_REWARD_SCOPES as readonly string[]).includes(value);
}

// Real shop_cases codes used by the project economy.
export const SEASON_REWARD_PREMIUM_CASE = "premium";
export const SEASON_REWARD_STANDARD_CASE = "daily_free";

export type SeasonRewardRuleInput = {
  id?: number | null;
  scope: string;
  rank_from: number;
  rank_to: number;
  reward_balls?: number;
  reward_stars?: number;
  reward_case_type?: string | null;
  reward_case_count?: number;
  enabled?: boolean;
  title?: string | null;
  description?: string | null;
  sort_order?: number;
};

export type SeasonRewardRule = {
  id: number | null;
  scope: SeasonRewardScope;
  rank_from: number;
  rank_to: number;
  reward_balls: number;
  reward_stars: number;
  reward_case_type: string | null;
  reward_case_count: number;
  enabled: boolean;
  title: string | null;
  description: string | null;
  sort_order: number;
};

// Default rules per scope (editable by admin). Stars stay 0 on R1 (balls + cases only).
export const DEFAULT_SEASON_REWARD_RULES: Record<SeasonRewardScope, Omit<SeasonRewardRule, "id">[]> = {
  season_overall: [
    { scope: "season_overall", rank_from: 1, rank_to: 1, reward_balls: 300, reward_stars: 0, reward_case_type: SEASON_REWARD_PREMIUM_CASE, reward_case_count: 3, enabled: true, title: "1 место", description: null, sort_order: 1 },
    { scope: "season_overall", rank_from: 2, rank_to: 2, reward_balls: 200, reward_stars: 0, reward_case_type: SEASON_REWARD_PREMIUM_CASE, reward_case_count: 2, enabled: true, title: "2 место", description: null, sort_order: 2 },
    { scope: "season_overall", rank_from: 3, rank_to: 3, reward_balls: 150, reward_stars: 0, reward_case_type: SEASON_REWARD_PREMIUM_CASE, reward_case_count: 1, enabled: true, title: "3 место", description: null, sort_order: 3 },
    { scope: "season_overall", rank_from: 4, rank_to: 10, reward_balls: 75, reward_stars: 0, reward_case_type: SEASON_REWARD_STANDARD_CASE, reward_case_count: 1, enabled: true, title: "4–10 место", description: null, sort_order: 4 },
    { scope: "season_overall", rank_from: 11, rank_to: 50, reward_balls: 25, reward_stars: 0, reward_case_type: null, reward_case_count: 0, enabled: true, title: "11–50 место", description: null, sort_order: 5 },
  ],
  top5_overall: [
    { scope: "top5_overall", rank_from: 1, rank_to: 1, reward_balls: 120, reward_stars: 0, reward_case_type: SEASON_REWARD_PREMIUM_CASE, reward_case_count: 1, enabled: true, title: "1 место", description: null, sort_order: 1 },
    { scope: "top5_overall", rank_from: 2, rank_to: 2, reward_balls: 90, reward_stars: 0, reward_case_type: SEASON_REWARD_STANDARD_CASE, reward_case_count: 1, enabled: true, title: "2 место", description: null, sort_order: 2 },
    { scope: "top5_overall", rank_from: 3, rank_to: 3, reward_balls: 60, reward_stars: 0, reward_case_type: SEASON_REWARD_STANDARD_CASE, reward_case_count: 1, enabled: true, title: "3 место", description: null, sort_order: 3 },
    { scope: "top5_overall", rank_from: 4, rank_to: 10, reward_balls: 25, reward_stars: 0, reward_case_type: null, reward_case_count: 0, enabled: true, title: "4–10 место", description: null, sort_order: 4 },
  ],
  eurocups_overall: [
    { scope: "eurocups_overall", rank_from: 1, rank_to: 1, reward_balls: 120, reward_stars: 0, reward_case_type: SEASON_REWARD_PREMIUM_CASE, reward_case_count: 1, enabled: true, title: "1 место", description: null, sort_order: 1 },
    { scope: "eurocups_overall", rank_from: 2, rank_to: 2, reward_balls: 90, reward_stars: 0, reward_case_type: SEASON_REWARD_STANDARD_CASE, reward_case_count: 1, enabled: true, title: "2 место", description: null, sort_order: 2 },
    { scope: "eurocups_overall", rank_from: 3, rank_to: 3, reward_balls: 60, reward_stars: 0, reward_case_type: SEASON_REWARD_STANDARD_CASE, reward_case_count: 1, enabled: true, title: "3 место", description: null, sort_order: 3 },
    { scope: "eurocups_overall", rank_from: 4, rank_to: 10, reward_balls: 25, reward_stars: 0, reward_case_type: null, reward_case_count: 0, enabled: true, title: "4–10 место", description: null, sort_order: 4 },
  ],
};

function toInt(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : 0;
}

// Validate + normalize a set of rules for ONE scope. Throws coded errors.
export function validateSeasonRewardRules(
  rawRules: SeasonRewardRuleInput[],
  opts: { scope: string; validCaseTypes: Set<string> },
): SeasonRewardRule[] {
  if (!isSeasonRewardScope(opts.scope)) throw new Error("INVALID_SCOPE");
  const normalized: SeasonRewardRule[] = [];
  for (const r of rawRules) {
    if (!isSeasonRewardScope(r.scope) || r.scope !== opts.scope) throw new Error("INVALID_SCOPE");
    const rank_from = toInt(r.rank_from);
    const rank_to = toInt(r.rank_to);
    if (rank_from < 1 || rank_to < rank_from) throw new Error("RANK_RANGE_INVALID");
    const reward_balls = toInt(r.reward_balls);
    const reward_stars = toInt(r.reward_stars);
    const reward_case_count = toInt(r.reward_case_count);
    if (reward_balls < 0 || reward_stars < 0 || reward_case_count < 0) throw new Error("REWARD_NEGATIVE");
    const reward_case_type = r.reward_case_type == null || r.reward_case_type === "" ? null : String(r.reward_case_type);
    if (reward_case_count > 0 && !reward_case_type) throw new Error("CASE_COUNT_REQUIRES_TYPE");
    if (reward_case_type && !opts.validCaseTypes.has(reward_case_type)) throw new Error("UNKNOWN_CASE_TYPE");
    normalized.push({
      id: r.id ?? null,
      scope: opts.scope,
      rank_from,
      rank_to,
      reward_balls,
      reward_stars,
      reward_case_type,
      reward_case_count,
      enabled: r.enabled === undefined ? true : !!r.enabled,
      title: r.title == null || r.title === "" ? null : String(r.title),
      description: r.description == null || r.description === "" ? null : String(r.description),
      sort_order: r.sort_order == null ? 100 : toInt(r.sort_order),
    });
  }
  assertNoOverlap(normalized);
  return normalized;
}

// Enabled rules must not have overlapping rank ranges within a scope.
export function assertNoOverlap(rules: SeasonRewardRule[]): void {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.rank_from - b.rank_from);
  for (let i = 1; i < enabled.length; i += 1) {
    if (enabled[i].rank_from <= enabled[i - 1].rank_to) throw new Error("RANK_RANGE_OVERLAP");
  }
}

// First enabled rule whose range covers `rank` (1-based). null when none.
export function matchRuleForRank(rules: SeasonRewardRule[], rank: number): SeasonRewardRule | null {
  for (const r of rules) {
    if (r.enabled && rank >= r.rank_from && rank <= r.rank_to) return r;
  }
  return null;
}

export function ruleIsNoOp(rule: SeasonRewardRule): boolean {
  return rule.reward_balls <= 0 && rule.reward_stars <= 0 && rule.reward_case_count <= 0;
}

export type RewardLeaderboardEntry = {
  user_id: number;
  total_points: number;
  max_possible_points: number;
};

export type RewardRecipient = {
  rank: number;
  user_id: number;
  total_points: number;
  max_possible_points: number;
  rule_id: number | null;
  reward_balls: number;
  reward_stars: number;
  reward_case_type: string | null;
  reward_case_count: number;
};

// Map a sorted leaderboard (rank = index + 1) to reward recipients. Skips ranks
// with no matching enabled rule and no-op rules.
export function buildRewardRecipients(
  sortedLeaderboard: RewardLeaderboardEntry[],
  rules: SeasonRewardRule[],
): RewardRecipient[] {
  const out: RewardRecipient[] = [];
  sortedLeaderboard.forEach((entry, idx) => {
    const rank = idx + 1;
    const rule = matchRuleForRank(rules, rank);
    if (!rule || ruleIsNoOp(rule)) return;
    out.push({
      rank,
      user_id: entry.user_id,
      total_points: entry.total_points,
      max_possible_points: entry.max_possible_points,
      rule_id: rule.id,
      reward_balls: rule.reward_balls,
      reward_stars: rule.reward_stars,
      reward_case_type: rule.reward_case_type,
      reward_case_count: rule.reward_case_count,
    });
  });
  return out;
}

// Stable idempotency key for the WHOLE reward package of one (season, scope, user).
// CRITICAL: must NOT depend on rule_id / rank range — otherwise editing or saving
// reward rules would change the key and allow a second grant. Components append a
// suffix (:balls / :stars / :case:{type}); metadata carries rule_id/rank/etc.
// A user can be rewarded for a given scope at most once per season.
export function rewardUniqueKeyBase(seasonId: number, scope: SeasonRewardScope, userId: number): string {
  return `season_prediction_reward:${seasonId}:${scope}:${userId}`;
}
