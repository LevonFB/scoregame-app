import { describe, it, expect } from "vitest";
import {
  resolvePaymentMethod,
  luckyTokenSpinCost,
  LUCKY_TOKEN_SPIN_COST,
  validateLuckyTokenAmount,
  normalizeLuckyTokenAmount,
  canonicalRewardType,
  isLuckyTokenRewardType,
  LUCKY_TOKEN_OPS,
  LUCKY_TOKEN_ITEM_TYPE,
} from "../luckyToken";

describe("resolvePaymentMethod", () => {
  it("accepts the two explicit methods", () => {
    expect(resolvePaymentMethod("lucky_token")).toBe("lucky_token");
    expect(resolvePaymentMethod("balls")).toBe("balls");
    expect(resolvePaymentMethod(" balls ")).toBe("balls");
  });
  it("throws on missing/unknown (no implicit fallback)", () => {
    expect(() => resolvePaymentMethod("")).toThrow("FORTUNE_PAYMENT_METHOD_REQUIRED");
    expect(() => resolvePaymentMethod(null)).toThrow("FORTUNE_PAYMENT_METHOD_REQUIRED");
    expect(() => resolvePaymentMethod(undefined)).toThrow("FORTUNE_PAYMENT_METHOD_REQUIRED");
    expect(() => resolvePaymentMethod("stars")).toThrow("FORTUNE_PAYMENT_METHOD_REQUIRED");
    expect(() => resolvePaymentMethod("fortune_spin")).toThrow("FORTUNE_PAYMENT_METHOD_REQUIRED");
  });
});

describe("luckyTokenSpinCost", () => {
  it("is fixed at 1 token = 1 spin", () => {
    expect(luckyTokenSpinCost()).toBe(1);
    expect(LUCKY_TOKEN_SPIN_COST).toBe(1);
  });
});

describe("validateLuckyTokenAmount", () => {
  it("accepts valid positive integers", () => {
    expect(validateLuckyTokenAmount(1)).toBe(1);
    expect(validateLuckyTokenAmount("3")).toBe(3);
  });
  it("treats 0 as disabled only when allowZero", () => {
    expect(validateLuckyTokenAmount(0, { allowZero: true })).toBe(0);
    expect(validateLuckyTokenAmount("", { allowZero: true })).toBe(0);
    expect(() => validateLuckyTokenAmount(0)).toThrow(/LUCKY_TOKEN_AMOUNT_TOO_SMALL/);
    expect(() => validateLuckyTokenAmount("")).toThrow(/LUCKY_TOKEN_AMOUNT_REQUIRED/);
  });
  it("rejects fractional / negative / over-max", () => {
    expect(() => validateLuckyTokenAmount(1.5)).toThrow(/NOT_INTEGER/);
    expect(() => validateLuckyTokenAmount(-2, { allowZero: true })).toThrow(/NEGATIVE/);
    expect(() => validateLuckyTokenAmount(9999)).toThrow(/OVER_MAX/);
  });
});

describe("normalizeLuckyTokenAmount", () => {
  it("clamps to [0, max] and never throws", () => {
    expect(normalizeLuckyTokenAmount(undefined)).toBe(0);
    expect(normalizeLuckyTokenAmount(-5)).toBe(0);
    expect(normalizeLuckyTokenAmount(2.9)).toBe(2);
    expect(normalizeLuckyTokenAmount(99999)).toBe(50);
  });
});

describe("reward type canonicalization", () => {
  it("maps the legacy fortune_spin alias to lucky_token", () => {
    expect(canonicalRewardType("fortune_spin")).toBe(LUCKY_TOKEN_ITEM_TYPE);
    expect(canonicalRewardType("LUCKY_TOKEN")).toBe("lucky_token");
    expect(isLuckyTokenRewardType("fortune_spin")).toBe(true);
    expect(isLuckyTokenRewardType("lucky_token")).toBe(true);
    expect(isLuckyTokenRewardType("balls")).toBe(false);
  });
});

describe("operation types", () => {
  it("exposes the distinct ledger op codes", () => {
    expect(LUCKY_TOKEN_OPS).toMatchObject({
      taskReward: "task_reward_lucky_token",
      caseDrop: "case_drop_lucky_token",
      spin: "lucky_ball_spin_token",
      adminGrant: "admin_grant_lucky_token",
      adminRevoke: "admin_revoke_lucky_token",
    });
  });
});
