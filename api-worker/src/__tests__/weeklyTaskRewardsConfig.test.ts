import { describe, it, expect } from "vitest";
import {
  WEEKLY_TASK_REWARDS_DEFAULTS,
  WEEKLY_REWARD_LIMITS,
  cloneWeeklyTaskRewardsDefaults,
  normalizeWeeklyRewardComponent,
  normalizeWeeklyTaskRewardsConfig,
  parseWeeklyTaskRewardsFromSettings,
  validateWeeklyTaskRewardsInput,
  weeklyRewardComponentToReward,
  weeklyMaxRewardSummary,
  buildWeeklyChallengeTasksForUser,
  type WeeklyTaskBuilderInput,
} from "../seasonPredictionWeeklyTasks";

const comp = (stars: number, balls = 0, case_type: string | null = null, case_count = 0, lucky_tokens = 0, boost_type: string | null = null, boost_count = 0) => ({ stars, balls, case_type, case_count, lucky_tokens, boost_type, boost_count });
const FULL = {
  version: 1,
  participation: comp(2),
  bonus: {
    match_of_week: comp(2), league_of_week: comp(2), duel_of_week: comp(2), upset_of_week: comp(2), event_of_week: comp(2),
  },
  result: {
    start: comp(1, 0, null, 0, 0, "double_chance", 1), bronze: comp(1), silver: comp(2), gold: comp(3, 1), perfect: comp(5, 0, "basic", 1),
  },
};

describe("defaults + convert + max", () => {
  it("defaults match the historical hardcoded values", () => {
    expect(WEEKLY_TASK_REWARDS_DEFAULTS).toEqual(FULL);
    expect(cloneWeeklyTaskRewardsDefaults()).not.toBe(WEEKLY_TASK_REWARDS_DEFAULTS);
  });
  it("converts component → reward (case_type + lucky_tokens + boost preserved)", () => {
    expect(weeklyRewardComponentToReward({ stars: 5, balls: 0, case_type: "premium", case_count: 1, lucky_tokens: 0, boost_type: null, boost_count: 0 })).toEqual({ stars: 5, balls: 0, case_type: "premium", case_count: 1, lucky_tokens: 0, boost_type: null, boost_count: 0 });
    expect(weeklyRewardComponentToReward({ stars: 3, balls: 1, case_type: null, case_count: 0, lucky_tokens: 2, boost_type: null, boost_count: 0 })).toEqual({ stars: 3, balls: 1, case_type: null, case_count: 0, lucky_tokens: 2, boost_type: null, boost_count: 0 });
    expect(weeklyRewardComponentToReward({ stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: "extra_joker", boost_count: 2 })).toEqual({ stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: "extra_joker", boost_count: 2 });
  });
  it("max = participation + selected bonus + perfect; cases aggregated by type; lucky tokens summed; boosts aggregated", () => {
    expect(weeklyMaxRewardSummary(WEEKLY_TASK_REWARDS_DEFAULTS, "upset")).toEqual({ stars: 9, balls: 0, cases: { basic: 1 }, lucky_tokens: 0, boosts: {} });
    expect(weeklyMaxRewardSummary(WEEKLY_TASK_REWARDS_DEFAULTS, "event")).toEqual({ stars: 9, balls: 0, cases: { basic: 1 }, lucky_tokens: 0, boosts: {} });
    const tokenCfg = normalizeWeeklyTaskRewardsConfig({ ...FULL, participation: { stars: 1, lucky_tokens: 3 }, result: { ...FULL.result, perfect: { stars: 5, lucky_tokens: 2 } } });
    expect(weeklyMaxRewardSummary(tokenCfg, "event").lucky_tokens).toBe(5);
    // Distinct case types are kept separate.
    const mixed = normalizeWeeklyTaskRewardsConfig({ ...FULL, participation: { stars: 1, case_type: "premium", case_count: 2 } });
    expect(weeklyMaxRewardSummary(mixed, "event").cases).toEqual({ premium: 2, basic: 1 });
  });
});

describe("normalize (lenient read path)", () => {
  it("missing/NaN/decimal/over-range coerce to safe ints; legacy basic_cases supported", () => {
    expect(normalizeWeeklyRewardComponent({ stars: "3.7", balls: -5, case_type: "premium", case_count: 99 })).toEqual({ stars: 3, balls: 0, case_type: "premium", case_count: WEEKLY_REWARD_LIMITS.case_count.max, lucky_tokens: 0, boost_type: null, boost_count: 0 });
    expect(normalizeWeeklyRewardComponent({ basic_cases: 2 })).toEqual({ stars: 0, balls: 0, case_type: "basic", case_count: 2, lucky_tokens: 0, boost_type: null, boost_count: 0 });
    expect(normalizeWeeklyRewardComponent(null)).toEqual({ stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });
    expect(normalizeWeeklyRewardComponent({ lucky_tokens: "4.9" })).toEqual({ stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 4, boost_type: null, boost_count: 0 });
    expect(normalizeWeeklyRewardComponent({ lucky_tokens: 999 }).lucky_tokens).toBe(WEEKLY_REWARD_LIMITS.lucky_tokens.max);
    // boost: valid type kept; unknown type coerced to default; count>max clamped; count 0 clears type.
    expect(normalizeWeeklyRewardComponent({ boost_type: "double_chance", boost_count: 2 })).toMatchObject({ boost_type: "double_chance", boost_count: 2 });
    expect(normalizeWeeklyRewardComponent({ boost_type: "nonsense", boost_count: 1 })).toMatchObject({ boost_type: "extra_joker", boost_count: 1 });
    expect(normalizeWeeklyRewardComponent({ boost_type: "extra_joker", boost_count: 999 }).boost_count).toBe(WEEKLY_REWARD_LIMITS.boost_count.max);
    expect(normalizeWeeklyRewardComponent({ boost_type: "extra_joker", boost_count: 0 }).boost_type).toBeNull();
  });
  it("normalizeWeeklyTaskRewardsConfig fills missing keys from defaults", () => {
    const c = normalizeWeeklyTaskRewardsConfig({ participation: { stars: 7 } });
    expect(c.participation.stars).toBe(7);
    expect(c.bonus.upset_of_week.stars).toBe(2);
    expect(c.result.perfect.case_count).toBe(1);
    expect(c.result.perfect.case_type).toBe("basic");
  });
});

describe("parse from settings", () => {
  it("absent → default; custom → custom; merge preserves nothing it shouldn't", () => {
    expect(parseWeeklyTaskRewardsFromSettings({}).source).toBe("default");
    expect(parseWeeklyTaskRewardsFromSettings({ competition_mode: "club" }).source).toBe("default");
    const custom = parseWeeklyTaskRewardsFromSettings({ weekly_task_rewards: { participation: { stars: 9 } } });
    expect(custom.source).toBe("custom");
    expect(custom.config.participation.stars).toBe(9);
  });
  it("malformed → defaults + malformed flag, never throws", () => {
    expect(parseWeeklyTaskRewardsFromSettings({ weekly_task_rewards: "broken" })).toMatchObject({ source: "default", malformed: true });
    expect(parseWeeklyTaskRewardsFromSettings({ weekly_task_rewards: 123 }).config).toEqual(FULL);
  });
});

describe("validate (strict write path)", () => {
  it("accepts a valid full payload", () => {
    expect(() => validateWeeklyTaskRewardsInput(FULL)).not.toThrow();
  });
  it("rejects negative / decimal / over-max", () => {
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(-1) })).toThrow(/WEEKLY_REWARD_NEGATIVE/);
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(1.5) })).toThrow(/WEEKLY_REWARD_INVALID_NUMBER/);
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(999) })).toThrow(/WEEKLY_REWARD_OVER_MAX/);
  });
  it("rejects a fully empty reward", () => {
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(0) })).toThrow(/WEEKLY_REWARD_EMPTY:participation/);
    const badBonus = { ...FULL, bonus: { ...FULL.bonus, upset_of_week: comp(0) } };
    expect(() => validateWeeklyTaskRewardsInput(badBonus)).toThrow(/WEEKLY_REWARD_EMPTY:bonus.upset_of_week/);
  });
  it("lucky_tokens: token-only reward is valid; negative/decimal/over-max rejected", () => {
    const tokenOnly = { ...FULL, participation: comp(0, 0, null, 0, 3) };
    expect(() => validateWeeklyTaskRewardsInput(tokenOnly)).not.toThrow();
    expect(validateWeeklyTaskRewardsInput(tokenOnly).participation.lucky_tokens).toBe(3);
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(1, 0, null, 0, -1) })).toThrow(/WEEKLY_REWARD_NEGATIVE/);
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(1, 0, null, 0, 1.5) })).toThrow(/WEEKLY_REWARD_INVALID_NUMBER/);
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(1, 0, null, 0, 999) })).toThrow(/WEEKLY_REWARD_OVER_MAX/);
  });
  it("case_type: accepts allowed, defaults to basic, rejects unknown", () => {
    const allowed = new Set(["basic", "premium", "daily_free"]);
    const withPremium = { ...FULL, result: { ...FULL.result, perfect: comp(5, 0, "premium", 1) } };
    expect(validateWeeklyTaskRewardsInput(withPremium, allowed).result.perfect.case_type).toBe("premium");
    // count>0 without explicit type → "basic"
    const noType = { ...FULL, result: { ...FULL.result, perfect: { stars: 5, balls: 0, case_count: 1 } } };
    expect(validateWeeklyTaskRewardsInput(noType, allowed).result.perfect.case_type).toBe("basic");
    // unknown type rejected
    const unknown = { ...FULL, result: { ...FULL.result, perfect: comp(5, 0, "legendary", 1) } };
    expect(() => validateWeeklyTaskRewardsInput(unknown, allowed)).toThrow(/WEEKLY_REWARD_INVALID_CASE_TYPE/);
    // count 0 → case_type forced null
    expect(validateWeeklyTaskRewardsInput(FULL, allowed).participation.case_type).toBeNull();
  });
  it("boost: allowed only on result tiers; participation/bonus reject; unknown type rejected", () => {
    // Boost on a result tier is accepted, type + count preserved.
    const withBoost = { ...FULL, result: { ...FULL.result, gold: comp(3, 1, null, 0, 0, "double_chance", 2) } };
    const v = validateWeeklyTaskRewardsInput(withBoost);
    expect(v.result.gold).toMatchObject({ boost_type: "double_chance", boost_count: 2 });
    // count>0 without explicit type → default extra_joker.
    const noType = { ...FULL, result: { ...FULL.result, silver: { stars: 2, boost_count: 1 } } };
    expect(validateWeeklyTaskRewardsInput(noType).result.silver.boost_type).toBe("extra_joker");
    // Boost on participation → rejected.
    expect(() => validateWeeklyTaskRewardsInput({ ...FULL, participation: comp(2, 0, null, 0, 0, "extra_joker", 1) })).toThrow(/WEEKLY_REWARD_BOOST_NOT_ALLOWED:participation/);
    // Boost on a bonus question → rejected.
    const badBonus = { ...FULL, bonus: { ...FULL.bonus, upset_of_week: comp(2, 0, null, 0, 0, "extra_joker", 1) } };
    expect(() => validateWeeklyTaskRewardsInput(badBonus)).toThrow(/WEEKLY_REWARD_BOOST_NOT_ALLOWED:bonus.upset_of_week/);
    // Unknown boost type on result → rejected.
    const unknown = { ...FULL, result: { ...FULL.result, gold: comp(3, 1, null, 0, 0, "mega_boost", 1) } };
    expect(() => validateWeeklyTaskRewardsInput(unknown)).toThrow(/WEEKLY_REWARD_INVALID_BOOST_TYPE/);
    // Boost-only result tier is a valid (non-empty) reward.
    const boostOnly = { ...FULL, result: { ...FULL.result, bronze: comp(0, 0, null, 0, 0, "extra_joker", 1) } };
    expect(() => validateWeeklyTaskRewardsInput(boostOnly)).not.toThrow();
  });
});

describe("task builder uses resolved reward config", () => {
  function v2Input(rewardConfig?: WeeklyTaskBuilderInput["rewardConfig"]): WeeklyTaskBuilderInput {
    return {
      userId: 1, seasonId: 1,
      challenge: { id: 10, title: "W", status: "completed", deadline_at: 1, task_schema_version: 2, bonus_question_key: "upset" },
      entry: { status: "completed", answers: {}, submitted_at: 1 },
      activeQuestionKeys: ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"],
      score: { total_points: 5, max_possible_points: 5, correct_answers: 5 },
      questionResults: { upset_of_week: { status: "correct", points: 1 } },
      seasonSubmittedCount: 1,
      claimedUniqueKeys: [],
      rewardConfig,
    };
  }

  it("participation/bonus/result rewards come from custom config", () => {
    const custom = normalizeWeeklyTaskRewardsConfig({
      participation: { stars: 7 },
      bonus: { ...FULL.bonus, upset_of_week: { stars: 9, balls: 0, basic_cases: 0 } },
      result: { ...FULL.result, perfect: { stars: 11, balls: 2, basic_cases: 2 } },
    });
    const views = buildWeeklyChallengeTasksForUser(v2Input(custom));
    const participation = views.find((v) => v.key === "weekly_challenge_participation")!;
    const bonus = views.find((v) => v.key === "weekly_challenge_bonus")!;
    const result = views.find((v) => v.key === "weekly_challenge_result")!;
    expect(participation.reward).toMatchObject({ stars: 7 });
    expect(bonus.reward).toMatchObject({ stars: 9 });
    expect(result.reward).toMatchObject({ stars: 11, balls: 2, case_type: "basic", case_count: 2 });
  });

  it("absent config falls back to defaults", () => {
    const views = buildWeeklyChallengeTasksForUser(v2Input(undefined));
    expect(views.find((v) => v.key === "weekly_challenge_participation")!.reward).toMatchObject({ stars: 2 });
    expect(views.find((v) => v.key === "weekly_challenge_result")!.reward).toMatchObject({ stars: 5, case_type: "basic", case_count: 1 });
  });
});
