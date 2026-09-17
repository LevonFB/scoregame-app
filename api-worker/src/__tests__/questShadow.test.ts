import { describe, expect, it } from "vitest";
import {
  buildQuestEvent,
  buildQuestEventIdempotencyKey,
  classifyQuestShadow,
  eventPhase,
  isQuestApplyUser,
  isSupportedQuestEvent,
  parseUserIdAllowlist,
  shouldRunQuestShadow,
  shouldSkipReadReconcile,
} from "../questShadow";

describe("parseUserIdAllowlist", () => {
  it("empty / missing → empty set (nobody)", () => {
    expect(parseUserIdAllowlist(undefined).size).toBe(0);
    expect(parseUserIdAllowlist("").size).toBe(0);
    expect(parseUserIdAllowlist("  ").size).toBe(0);
  });
  it("parses comma/space separated positive ints, ignores invalid", () => {
    const s = parseUserIdAllowlist("1, 2  3,abc,-4,0,5x,6");
    expect([...s].sort((a, b) => a - b)).toEqual([1, 2, 3, 6]);
  });
});

describe("shouldSkipReadReconcile (Stage 5 gating)", () => {
  const lists = (apply: number[], skip: number[], applyV2 = true) => ({ applyV2, applyUserIds: new Set(apply), skipReconcileUserIds: new Set(skip) });
  it("apply off → never skip", () => {
    expect(shouldSkipReadReconcile(7, lists([7], [7], false)).skip).toBe(false);
  });
  it("not in apply allowlist → never skip", () => {
    expect(shouldSkipReadReconcile(7, lists([], [7])).skip).toBe(false);
  });
  it("in apply but not in skip list → never skip", () => {
    expect(shouldSkipReadReconcile(7, lists([7], [])).skip).toBe(false);
  });
  it("apply on + in both lists → skip", () => {
    expect(shouldSkipReadReconcile(7, lists([7], [7]))).toEqual({ skip: true, reason: "allowlisted" });
  });
  it("a different user is not affected", () => {
    expect(shouldSkipReadReconcile(8, lists([7], [7])).skip).toBe(false);
  });
  it("skipAll global kill-switch → skip for everyone, even outside allowlists", () => {
    expect(shouldSkipReadReconcile(8, { ...lists([], [], false), skipAll: true }))
      .toEqual({ skip: true, reason: "global_disable" });
  });
  it("skipAll undefined/false → falls through to allowlist gating", () => {
    expect(shouldSkipReadReconcile(7, { ...lists([7], [7]), skipAll: false }).reason).toBe("allowlisted");
    expect(shouldSkipReadReconcile(7, lists([], [], false)).skip).toBe(false);
  });
  it("isQuestApplyUser reflects apply allowlist membership", () => {
    expect(isQuestApplyUser(7, lists([7], []))).toBe(true);
    expect(isQuestApplyUser(8, lists([7], []))).toBe(false);
    expect(isQuestApplyUser(7, lists([7], [], false))).toBe(false);
  });
});

describe("event model + idempotency", () => {
  it("idempotency key is stable for the same action", () => {
    const a = buildQuestEventIdempotencyKey("prediction_saved", 7, "2026-06-10", "m1");
    const b = buildQuestEventIdempotencyKey("prediction_saved", 7, "2026-06-10", "m1");
    expect(a).toBe(b);
    expect(a).toBe("quest-evt:prediction_saved:2026-06-10:7:m1");
  });
  it("different action/day/match → different key", () => {
    const base = buildQuestEventIdempotencyKey("prediction_saved", 7, "2026-06-10", "m1");
    expect(buildQuestEventIdempotencyKey("joker_used", 7, "2026-06-10", "m1")).not.toBe(base);
    expect(buildQuestEventIdempotencyKey("prediction_saved", 7, "2026-06-11", "m1")).not.toBe(base);
    expect(buildQuestEventIdempotencyKey("prediction_saved", 7, "2026-06-10", "m2")).not.toBe(base);
  });
  it("buildQuestEvent contains only minimal safe fields (no initData/token/username)", () => {
    const e = buildQuestEvent("prediction_saved", 7, "2026-06-10", { matchId: "m1", occurredAt: 123 });
    expect(Object.keys(e).sort()).toEqual(
      ["event_id", "event_type", "idempotency_key", "match_id", "occurred_at", "period_key", "schema_version", "user_id"].sort()
    );
    expect(JSON.stringify(e)).not.toMatch(/initData|token|username/i);
  });
});

describe("event → phase / support", () => {
  it("maps action events to daily-quest phases", () => {
    expect(eventPhase("prediction_saved")).toBe("pick_saved");
    expect(eventPhase("joker_used")).toBe("pick_saved");
    expect(eventPhase("match_scored")).toBe("scores_updated");
  });
  it("case_opened has no daily quest → unsupported", () => {
    expect(eventPhase("case_opened")).toBe(null);
    expect(isSupportedQuestEvent("case_opened")).toBe(false);
  });
});

describe("shouldRunQuestShadow flags", () => {
  it("V2 off → never run (default behavior)", () => {
    expect(shouldRunQuestShadow({ questEventSyncV2: false, questEventSyncShadow: false })).toEqual({ run: false, reason: "v2_disabled" });
    expect(shouldRunQuestShadow({ questEventSyncV2: false, questEventSyncShadow: true }).run).toBe(false);
  });
  it("V2 on + shadow on → run compute+compare", () => {
    expect(shouldRunQuestShadow({ questEventSyncV2: true, questEventSyncShadow: true })).toEqual({ run: true, reason: "shadow_on" });
  });
  it("V2 on + shadow off → do NOT run, warn (apply forbidden this stage)", () => {
    const d = shouldRunQuestShadow({ questEventSyncV2: true, questEventSyncShadow: false });
    expect(d.run).toBe(false);
    expect(d.warn).toBe(true);
  });
});

describe("classifyQuestShadow", () => {
  const base = { supported: true, hasStoredRow: true, expectedCompleted: false, storedCompleted: false, expectedRewardEligible: false, storedRewarded: false };
  it("identical → match", () => {
    expect(classifyQuestShadow(base)).toBe("match");
    expect(classifyQuestShadow({ ...base, expectedCompleted: true, storedCompleted: true, expectedRewardEligible: true, storedRewarded: true })).toBe("match");
  });
  it("unsupported event short-circuits", () => {
    expect(classifyQuestShadow({ ...base, supported: false })).toBe("unsupported");
  });
  it("expected completed but no stored row → missing_progress", () => {
    expect(classifyQuestShadow({ ...base, hasStoredRow: false, expectedCompleted: true })).toBe("missing_progress");
  });
  it("completion differs → completion_mismatch", () => {
    expect(classifyQuestShadow({ ...base, expectedCompleted: true, storedCompleted: false })).toBe("completion_mismatch");
    expect(classifyQuestShadow({ ...base, expectedCompleted: false, storedCompleted: true })).toBe("completion_mismatch");
  });
  it("reward differs (completion same) → reward_mismatch", () => {
    expect(classifyQuestShadow({ ...base, expectedCompleted: true, storedCompleted: true, expectedRewardEligible: true, storedRewarded: false })).toBe("reward_mismatch");
  });
});
