import { describe, it, expect } from "vitest";
import {
  REFERRAL_CONFIG_DEFAULTS,
  buildReferralCode,
  parseReferralStartParam,
  parseReferralConfig,
  referralRewardLabel,
} from "../referral";

describe("buildReferralCode", () => {
  it("encodes a telegram id as base36 and round-trips through the parser", () => {
    for (const id of [1, 777777, 8_500_000_000]) {
      const code = buildReferralCode(id)!;
      expect(code).toBe(id.toString(36));
      expect(parseReferralStartParam(`ref_${code}`)).toEqual({ kind: "ref", userId: id });
    }
  });

  it("rejects invalid ids", () => {
    expect(buildReferralCode(0)).toBeNull();
    expect(buildReferralCode(-5)).toBeNull();
    expect(buildReferralCode(1.5)).toBeNull();
    expect(buildReferralCode(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});

describe("parseReferralStartParam", () => {
  it("parses ref_ codes case-insensitively", () => {
    expect(parseReferralStartParam("REF_ZZ")).toEqual({ kind: "ref", userId: parseInt("zz", 36) });
  });

  it("rejects non-canonical spellings (leading zeros) — one id, one code", () => {
    expect(parseReferralStartParam("ref_01")).toBeNull();
    expect(parseReferralStartParam("ref_007")).toBeNull();
  });

  it("rejects garbage, empty and oversized input", () => {
    expect(parseReferralStartParam("")).toBeNull();
    expect(parseReferralStartParam("ref_")).toBeNull();
    expect(parseReferralStartParam("ref_!!'--")).toBeNull();
    expect(parseReferralStartParam("join_abc")).toBeNull();
    expect(parseReferralStartParam("ref_zzzzzzzzzzzzzzzzzzzz")).toBeNull(); // > MAX_SAFE_INTEGER
  });

  it("parses ig_ ad codes and keeps the prefix in the stored source", () => {
    expect(parseReferralStartParam("ig_kz_feed_1")).toEqual({ kind: "src", code: "ig_kz_feed_1" });
    expect(parseReferralStartParam("IG_AM_REELS")).toEqual({ kind: "src", code: "ig_am_reels" });
    expect(parseReferralStartParam("ig_")).toBeNull();
    expect(parseReferralStartParam("ig_!!")).toBeNull();
  });

  it("parses src_ channel codes with a bounded slug", () => {
    expect(parseReferralStartParam("src_tiktok")).toEqual({ kind: "src", code: "tiktok" });
    expect(parseReferralStartParam("src_mu-1_x")).toEqual({ kind: "src", code: "mu-1_x" });
    expect(parseReferralStartParam("src_")).toBeNull();
    expect(parseReferralStartParam("src_-lead")).toBeNull(); // must start alphanumeric
    expect(parseReferralStartParam(`src_${"a".repeat(33)}`)).toBeNull(); // 32 max
  });
});

describe("parseReferralConfig", () => {
  it("accepts the defaults document unchanged", () => {
    const parsed = parseReferralConfig(JSON.parse(JSON.stringify(REFERRAL_CONFIG_DEFAULTS)));
    expect(parsed).toEqual(REFERRAL_CONFIG_DEFAULTS);
  });

  it("rejects unknown reward types and out-of-bounds amounts", () => {
    const base = JSON.parse(JSON.stringify(REFERRAL_CONFIG_DEFAULTS));
    expect(parseReferralConfig({ ...base, invitee_reward: { type: "balls", amount: 100 } })).toBeNull();
    expect(parseReferralConfig({ ...base, invitee_reward: { type: "stars", amount: 1 } })).toBeNull();
    expect(parseReferralConfig({ ...base, per_friend_reward: { type: "daily_case", amount: 0 } })).toBeNull();
    expect(parseReferralConfig({ ...base, per_friend_reward: { type: "daily_case", amount: 4 } })).toBeNull();
  });

  it("normalizes 'none' to amount 0 regardless of input", () => {
    const base = JSON.parse(JSON.stringify(REFERRAL_CONFIG_DEFAULTS));
    const parsed = parseReferralConfig({ ...base, per_friend_reward: { type: "none", amount: 99 } });
    expect(parsed?.per_friend_reward).toEqual({ type: "none", amount: 0 });
  });

  it("rejects invalid caps and milestone structures", () => {
    const base = JSON.parse(JSON.stringify(REFERRAL_CONFIG_DEFAULTS));
    expect(parseReferralConfig({ ...base, daily_cap: 0 })).toBeNull();
    expect(parseReferralConfig({ ...base, daily_cap: 101 })).toBeNull();
    expect(parseReferralConfig({ ...base, milestones: "x" })).toBeNull();
    expect(parseReferralConfig({ ...base, milestones: [{ count: 3, reward: { type: "premium_case", amount: 1 } }, { count: 3, reward: { type: "premium_case", amount: 1 } }] })).toBeNull(); // duplicate count
    expect(parseReferralConfig({ ...base, milestones: Array.from({ length: 11 }, (_, i) => ({ count: i + 1, reward: { type: "daily_case", amount: 1 } })) })).toBeNull(); // > 10
  });

  it("sorts milestones by count", () => {
    const base = JSON.parse(JSON.stringify(REFERRAL_CONFIG_DEFAULTS));
    const parsed = parseReferralConfig({
      ...base,
      milestones: [
        { count: 10, reward: { type: "premium_case", amount: 1 } },
        { count: 3, reward: { type: "premium_case", amount: 1 } },
      ],
    });
    expect(parsed?.milestones.map((m) => m.count)).toEqual([3, 10]);
  });

  it("rejects non-object / missing enabled", () => {
    expect(parseReferralConfig(null)).toBeNull();
    expect(parseReferralConfig("{}")).toBeNull();
    expect(parseReferralConfig({ ...REFERRAL_CONFIG_DEFAULTS, enabled: "yes" })).toBeNull();
  });
});

describe("referralRewardLabel", () => {
  it("labels all reward types and quantities", () => {
    expect(referralRewardLabel({ type: "daily_case", amount: 1 })).toBe("Ежедневный кейс");
    expect(referralRewardLabel({ type: "premium_case", amount: 2 })).toBe("Премиум-кейс ×2");
    expect(referralRewardLabel({ type: "lucky_token", amount: 1 })).toBe("Фартовый жетон");
    expect(referralRewardLabel({ type: "none", amount: 0 })).toBe("—");
  });
});
