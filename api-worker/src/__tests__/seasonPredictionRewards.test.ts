import { describe, it, expect } from "vitest";
import {
  buildRewardRecipients,
  DEFAULT_SEASON_REWARD_RULES,
  isSeasonRewardScope,
  matchRuleForRank,
  rewardUniqueKeyBase,
  validateSeasonRewardRules,
  type SeasonRewardRule,
  type SeasonRewardRuleInput,
} from "../seasonPredictionRewards";

const CASES = new Set(["premium", "daily_free"]);

function rule(p: Partial<SeasonRewardRuleInput> & { rank_from: number; rank_to: number }): SeasonRewardRuleInput {
  return { scope: "season_overall", reward_balls: 10, ...p };
}

describe("scope guard", () => {
  it("accepts the three scopes only", () => {
    expect(isSeasonRewardScope("season_overall")).toBe(true);
    expect(isSeasonRewardScope("top5_overall")).toBe(true);
    expect(isSeasonRewardScope("eurocups_overall")).toBe(true);
    expect(isSeasonRewardScope("PL")).toBe(false);
    expect(isSeasonRewardScope("season_individual")).toBe(false);
  });
});

describe("validateSeasonRewardRules", () => {
  it("accepts valid rules and normalizes", () => {
    const out = validateSeasonRewardRules([
      rule({ rank_from: 1, rank_to: 1, reward_balls: 300, reward_case_type: "premium", reward_case_count: 3 }),
      rule({ rank_from: 2, rank_to: 10, reward_balls: 50 }),
    ], { scope: "season_overall", validCaseTypes: CASES });
    expect(out).toHaveLength(2);
    expect(out[0].reward_case_type).toBe("premium");
    expect(out[0].enabled).toBe(true);
  });

  it("rejects a foreign/invalid scope", () => {
    expect(() => validateSeasonRewardRules([rule({ rank_from: 1, rank_to: 1, scope: "eurocups_overall" })], { scope: "season_overall", validCaseTypes: CASES })).toThrow("INVALID_SCOPE");
    expect(() => validateSeasonRewardRules([], { scope: "bad", validCaseTypes: CASES })).toThrow("INVALID_SCOPE");
  });

  it("rejects rank_from > rank_to and rank_from < 1", () => {
    expect(() => validateSeasonRewardRules([rule({ rank_from: 5, rank_to: 2 })], { scope: "season_overall", validCaseTypes: CASES })).toThrow("RANK_RANGE_INVALID");
    expect(() => validateSeasonRewardRules([rule({ rank_from: 0, rank_to: 1 })], { scope: "season_overall", validCaseTypes: CASES })).toThrow("RANK_RANGE_INVALID");
  });

  it("rejects overlapping enabled ranges", () => {
    expect(() => validateSeasonRewardRules([
      rule({ rank_from: 1, rank_to: 5 }),
      rule({ rank_from: 5, rank_to: 10 }),
    ], { scope: "season_overall", validCaseTypes: CASES })).toThrow("RANK_RANGE_OVERLAP");
  });

  it("allows overlapping ranges if one is disabled", () => {
    const out = validateSeasonRewardRules([
      rule({ rank_from: 1, rank_to: 5 }),
      rule({ rank_from: 5, rank_to: 10, enabled: false }),
    ], { scope: "season_overall", validCaseTypes: CASES });
    expect(out).toHaveLength(2);
  });

  it("rejects negative rewards", () => {
    expect(() => validateSeasonRewardRules([rule({ rank_from: 1, rank_to: 1, reward_balls: -5 })], { scope: "season_overall", validCaseTypes: CASES })).toThrow("REWARD_NEGATIVE");
  });

  it("rejects case_count without case_type", () => {
    expect(() => validateSeasonRewardRules([rule({ rank_from: 1, rank_to: 1, reward_case_count: 2, reward_case_type: null })], { scope: "season_overall", validCaseTypes: CASES })).toThrow("CASE_COUNT_REQUIRES_TYPE");
  });

  it("rejects unknown case_type", () => {
    expect(() => validateSeasonRewardRules([rule({ rank_from: 1, rank_to: 1, reward_case_type: "mystery_box", reward_case_count: 1 })], { scope: "season_overall", validCaseTypes: CASES })).toThrow("UNKNOWN_CASE_TYPE");
  });

  it("default rules pass validation for every scope", () => {
    for (const scope of ["season_overall", "top5_overall", "eurocups_overall"] as const) {
      const out = validateSeasonRewardRules(DEFAULT_SEASON_REWARD_RULES[scope], { scope, validCaseTypes: CASES });
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe("matchRuleForRank", () => {
  const rules = validateSeasonRewardRules(DEFAULT_SEASON_REWARD_RULES.season_overall, { scope: "season_overall", validCaseTypes: CASES });
  it("maps ranks to the covering rule", () => {
    expect(matchRuleForRank(rules, 1)?.rank_from).toBe(1);
    expect(matchRuleForRank(rules, 7)?.rank_from).toBe(4); // 4–10
    expect(matchRuleForRank(rules, 50)?.rank_from).toBe(11); // 11–50
    expect(matchRuleForRank(rules, 51)).toBeNull();
  });
});

describe("buildRewardRecipients", () => {
  const rules: SeasonRewardRule[] = validateSeasonRewardRules(DEFAULT_SEASON_REWARD_RULES.season_overall, { scope: "season_overall", validCaseTypes: CASES });
  it("maps a sorted leaderboard to recipients, skipping out-of-range ranks", () => {
    const lb = Array.from({ length: 60 }, (_, i) => ({ user_id: i + 1, total_points: 1000 - i, max_possible_points: 1357 }));
    const recipients = buildRewardRecipients(lb, rules);
    expect(recipients[0]).toMatchObject({ rank: 1, user_id: 1, reward_balls: 300, reward_case_type: "premium", reward_case_count: 3 });
    expect(recipients.find((r) => r.rank === 7)).toMatchObject({ reward_balls: 75, reward_case_type: "daily_free", reward_case_count: 1 });
    expect(recipients.find((r) => r.rank === 50)).toMatchObject({ reward_balls: 25, reward_case_count: 0 });
    expect(recipients.find((r) => r.rank === 51)).toBeUndefined(); // beyond 50 → no reward
    expect(recipients).toHaveLength(50);
  });

  it("skips no-op rules", () => {
    const noop = validateSeasonRewardRules([{ scope: "season_overall", rank_from: 1, rank_to: 5, reward_balls: 0, reward_case_count: 0 }], { scope: "season_overall", validCaseTypes: CASES });
    const lb = [{ user_id: 1, total_points: 10, max_possible_points: 100 }];
    expect(buildRewardRecipients(lb, noop)).toHaveLength(0);
  });
});

describe("rewardUniqueKeyBase", () => {
  it("is one stable key per (season, scope, user) — independent of any rule", () => {
    expect(rewardUniqueKeyBase(1, "season_overall", 123)).toBe("season_prediction_reward:1:season_overall:123");
    expect(rewardUniqueKeyBase(1, "top5_overall", 99)).toBe("season_prediction_reward:1:top5_overall:99");
    // contains no rule id and no rank range
    const key = rewardUniqueKeyBase(2, "eurocups_overall", 5);
    expect(key).toBe("season_prediction_reward:2:eurocups_overall:5");
    expect(/r\d|d\d+-\d+/.test(key)).toBe(false);
  });
  it("scopes are independent (different base keys)", () => {
    expect(rewardUniqueKeyBase(1, "season_overall", 7)).not.toBe(rewardUniqueKeyBase(1, "top5_overall", 7));
    expect(rewardUniqueKeyBase(1, "top5_overall", 7)).not.toBe(rewardUniqueKeyBase(1, "eurocups_overall", 7));
  });
});
