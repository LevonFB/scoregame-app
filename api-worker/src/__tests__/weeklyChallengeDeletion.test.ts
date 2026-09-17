import { describe, it, expect } from "vitest";
import { evaluateWeeklyChallengeDeletion, WEEKLY_CHALLENGE_DELETABLE_STATUSES } from "../seasonPredictionWeeklyLifecycle";

const ZERO = { entries: 0, claims: 0, rewards: 0, scores: 0 };

describe("evaluateWeeklyChallengeDeletion", () => {
  it("allows empty draft and empty archived", () => {
    expect(evaluateWeeklyChallengeDeletion("draft", ZERO)).toEqual({ deletable: true, error: null });
    expect(evaluateWeeklyChallengeDeletion("archived", ZERO)).toEqual({ deletable: true, error: null });
    expect([...WEEKLY_CHALLENGE_DELETABLE_STATUSES]).toEqual(["draft", "archived"]);
  });

  it("forbids active/locked/scoring/completed regardless of counts", () => {
    for (const s of ["active", "locked", "scoring", "completed"]) {
      expect(evaluateWeeklyChallengeDeletion(s, ZERO)).toEqual({ deletable: false, error: "WEEKLY_CHALLENGE_DELETE_FORBIDDEN_STATUS" });
    }
  });

  it("blocks on each dependency in priority order", () => {
    expect(evaluateWeeklyChallengeDeletion("draft", { ...ZERO, entries: 1 }).error).toBe("WEEKLY_CHALLENGE_DELETE_HAS_ENTRIES");
    expect(evaluateWeeklyChallengeDeletion("archived", { ...ZERO, claims: 1 }).error).toBe("WEEKLY_CHALLENGE_DELETE_HAS_CLAIMS");
    expect(evaluateWeeklyChallengeDeletion("draft", { ...ZERO, rewards: 1 }).error).toBe("WEEKLY_CHALLENGE_DELETE_HAS_REWARDS");
    expect(evaluateWeeklyChallengeDeletion("archived", { ...ZERO, scores: 1 }).error).toBe("WEEKLY_CHALLENGE_DELETE_HAS_DEPENDENCIES");
    // status check wins over dependency checks
    expect(evaluateWeeklyChallengeDeletion("completed", { ...ZERO, entries: 5 }).error).toBe("WEEKLY_CHALLENGE_DELETE_FORBIDDEN_STATUS");
  });
});
