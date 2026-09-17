import { describe, expect, it } from "vitest";
import {
  buildWeeklyPoolRefSet,
  canRecalcWeeklyChallenge,
  canTransitionWeeklyChallengeStatus,
  compareWeeklyQuestionStructure,
  findWeeklyQuestionMatchRefNotInPool,
  formatUnixSecondsForMskDateTimeLocal,
  isWeeklyRecalcRunningStale,
  parseMskDateTimeLocalToUnixSeconds,
  resolveWeeklyEditState,
  validateWeeklyActivationQuestions,
  validateWeeklyChallengeSchedule,
  weeklyChallengeResultsAreStale,
  weeklyEditStateAllowsStructural,
  weeklyOfficialAnswerStillValid,
  weeklyRecalcFinalStatus,
  type WeeklyActivationQuestion,
  type WeeklyQuestionStructure,
} from "../seasonPredictionWeeklyLifecycle";

describe("MSK datetime-local ↔ Unix seconds", () => {
  it("parses an MSK wall-clock string to UTC Unix seconds", () => {
    // 2026-08-15 16:30 MSK = 13:30 UTC
    expect(parseMskDateTimeLocalToUnixSeconds("2026-08-15T16:30")).toBe(Math.floor(Date.UTC(2026, 7, 15, 13, 30) / 1000));
  });

  it("formats Unix seconds back to MSK datetime-local", () => {
    const unix = Math.floor(Date.UTC(2026, 7, 15, 13, 30) / 1000);
    expect(formatUnixSecondsForMskDateTimeLocal(unix)).toBe("2026-08-15T16:30");
  });

  it("round-trips without drift", () => {
    const s = "2026-12-31T23:45";
    expect(formatUnixSecondsForMskDateTimeLocal(parseMskDateTimeLocalToUnixSeconds(s)!)).toBe(s);
  });

  it("is independent of the host timezone (uses Date.UTC, not Date.parse)", () => {
    // A fixed epoch always maps to the same MSK string regardless of process TZ.
    const unix = 1_760_000_000;
    const formatted = formatUnixSecondsForMskDateTimeLocal(unix);
    expect(parseMskDateTimeLocalToUnixSeconds(formatted)).toBe(unix - (unix % 60)); // minute precision
  });

  it("handles empty/invalid input", () => {
    expect(parseMskDateTimeLocalToUnixSeconds("")).toBeNull();
    expect(parseMskDateTimeLocalToUnixSeconds("nonsense")).toBeNull();
    expect(formatUnixSecondsForMskDateTimeLocal(null)).toBe("");
    expect(formatUnixSecondsForMskDateTimeLocal(undefined)).toBe("");
  });
});

describe("validateWeeklyChallengeSchedule", () => {
  it("accepts a correct full order", () => {
    expect(() => validateWeeklyChallengeSchedule({ openAt: 100, deadlineAt: 200, closeAt: 300 })).not.toThrow();
  });

  it("accepts partial (missing) dates", () => {
    expect(() => validateWeeklyChallengeSchedule({ openAt: null, deadlineAt: 200, closeAt: null })).not.toThrow();
    expect(() => validateWeeklyChallengeSchedule({ openAt: null, deadlineAt: null, closeAt: null })).not.toThrow();
  });

  it("rejects open == deadline", () => {
    expect(() => validateWeeklyChallengeSchedule({ openAt: 200, deadlineAt: 200, closeAt: 300 })).toThrow("WEEKLY_INVALID_DATE_ORDER");
  });

  it("rejects deadline > close", () => {
    expect(() => validateWeeklyChallengeSchedule({ openAt: 100, deadlineAt: 300, closeAt: 200 })).toThrow("WEEKLY_INVALID_DATE_ORDER");
  });

  it("allows deadline == close", () => {
    expect(() => validateWeeklyChallengeSchedule({ openAt: 100, deadlineAt: 200, closeAt: 200 })).not.toThrow();
  });

  it("rejects invalid timestamps", () => {
    expect(() => validateWeeklyChallengeSchedule({ openAt: Number.NaN, deadlineAt: null, closeAt: null })).toThrow("WEEKLY_INVALID_OPEN_AT");
    expect(() => validateWeeklyChallengeSchedule({ openAt: null, deadlineAt: 1.5, closeAt: null })).toThrow("WEEKLY_INVALID_DEADLINE_AT");
    expect(() => validateWeeklyChallengeSchedule({ openAt: null, deadlineAt: null, closeAt: -5 })).toThrow("WEEKLY_INVALID_CLOSE_AT");
  });
});

describe("canTransitionWeeklyChallengeStatus", () => {
  it("allows the forward flow", () => {
    expect(canTransitionWeeklyChallengeStatus("draft", "active")).toBe(true);
    expect(canTransitionWeeklyChallengeStatus("active", "locked")).toBe(true);
    expect(canTransitionWeeklyChallengeStatus("locked", "scoring")).toBe(true);
    expect(canTransitionWeeklyChallengeStatus("scoring", "completed")).toBe(true);
    expect(canTransitionWeeklyChallengeStatus("completed", "archived")).toBe(true);
  });

  it("allows the two intentional soft rollbacks", () => {
    expect(canTransitionWeeklyChallengeStatus("active", "draft")).toBe(true);
    expect(canTransitionWeeklyChallengeStatus("locked", "active")).toBe(true);
  });

  it("allows no-op (same status)", () => {
    expect(canTransitionWeeklyChallengeStatus("active", "active")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransitionWeeklyChallengeStatus("draft", "completed")).toBe(false);
    expect(canTransitionWeeklyChallengeStatus("active", "archived")).toBe(false);
    expect(canTransitionWeeklyChallengeStatus("completed", "active")).toBe(false);
    expect(canTransitionWeeklyChallengeStatus("archived", "active")).toBe(false);
    expect(canTransitionWeeklyChallengeStatus("scoring", "draft")).toBe(false);
  });
});

function q(over: Partial<WeeklyActivationQuestion> = {}): WeeklyActivationQuestion {
  return {
    question_key: over.question_key ?? "match_of_week",
    status: over.status ?? "active",
    options: over.options ?? [{ id: "home" }, { id: "away" }],
    config: over.config,
  };
}

function fiveValidQuestions(): WeeklyActivationQuestion[] {
  return [
    q({ question_key: "match_of_week", options: [{ id: "home" }, { id: "draw" }, { id: "away" }], config: { match_ref: "m1" } }),
    q({ question_key: "league_of_week", options: [{ id: "pl" }, { id: "pd" }] }),
    q({ question_key: "duel_of_week", options: [{ id: "player_a" }, { id: "player_b" }, { id: "equal" }] }),
    q({ question_key: "upset_of_week", options: [{ id: "upset_1" }, { id: "no_upset" }] }),
    q({ question_key: "event_of_week", options: [{ id: "yes" }, { id: "no" }] }),
  ];
}

describe("validateWeeklyActivationQuestions", () => {
  it("accepts a complete valid set", () => {
    expect(() => validateWeeklyActivationQuestions(fiveValidQuestions())).not.toThrow();
  });

  it("rejects when an active question key is missing", () => {
    const qs = fiveValidQuestions().filter((x) => x.question_key !== "event_of_week");
    expect(() => validateWeeklyActivationQuestions(qs)).toThrow(/WEEKLY_CHALLENGE_ACTIVE_REQUIRES_5_ACTIVE_QUESTIONS/);
  });

  it("rejects a question with fewer than two options", () => {
    const qs = fiveValidQuestions().map((x) => x.question_key === "league_of_week" ? q({ ...x, options: [{ id: "pl" }] }) : x);
    expect(() => validateWeeklyActivationQuestions(qs)).toThrow(/WEEKLY_QUESTION_NEEDS_AT_LEAST_TWO_OPTIONS:league_of_week/);
  });

  it("rejects a missing required special option (no_upset)", () => {
    const qs = fiveValidQuestions().map((x) => x.question_key === "upset_of_week" ? q({ ...x, options: [{ id: "upset_1" }, { id: "upset_2" }] }) : x);
    expect(() => validateWeeklyActivationQuestions(qs)).toThrow(/WEEKLY_QUESTION_MISSING_REQUIRED_OPTION:upset_of_week:no_upset/);
  });

  it("accepts upset_count (range template) without no_upset", () => {
    const qs = fiveValidQuestions().map((x) => x.question_key === "upset_of_week"
      ? q({ ...x, options: [{ id: "count_0" }, { id: "count_1" }, { id: "count_2" }, { id: "count_3_plus" }], config: { template_key: "upset_count" } })
      : x);
    expect(() => validateWeeklyActivationQuestions(qs)).not.toThrow();
  });

  it("rejects a missing duel special option", () => {
    const qs = fiveValidQuestions().map((x) => x.question_key === "duel_of_week" ? q({ ...x, options: [{ id: "player_a" }, { id: "player_b" }] }) : x);
    expect(() => validateWeeklyActivationQuestions(qs)).toThrow(/WEEKLY_QUESTION_MISSING_REQUIRED_OPTION:duel_of_week:equal/);
  });
});

describe("match_ref vs pool", () => {
  it("builds a pool ref set from match_id and synthetic pool_N", () => {
    const set = buildWeeklyPoolRefSet([{ match_id: "abc" }, { match_id: null }]);
    expect(set.has("abc")).toBe(true);
    expect(set.has("pool_1")).toBe(true);
    expect(set.has("pool_2")).toBe(true);
  });

  it("passes when every match_ref is in the pool", () => {
    const qs = [q({ question_key: "match_of_week", config: { match_ref: "abc" } })];
    expect(findWeeklyQuestionMatchRefNotInPool(qs, new Set(["abc", "pool_1"]))).toBeNull();
  });

  it("flags a question whose match_ref is not in the pool", () => {
    const qs = [q({ question_key: "match_of_week", config: { match_ref: "ghost" } })];
    expect(findWeeklyQuestionMatchRefNotInPool(qs, new Set(["abc"]))).toEqual({ question_key: "match_of_week", match_ref: "ghost" });
  });

  it("checks option-level match_ref (upset options)", () => {
    const qs = [q({ question_key: "upset_of_week", options: [{ id: "no_upset" }, { id: "upset_1", match_ref: "ghost" } as any] })];
    expect(findWeeklyQuestionMatchRefNotInPool(qs, new Set(["abc"]))).toEqual({ question_key: "upset_of_week", match_ref: "ghost" });
  });

  it("ignores inactive questions and missing refs", () => {
    const qs = [q({ status: "disabled", config: { match_ref: "ghost" } }), q({ question_key: "league_of_week", config: {} })];
    expect(findWeeklyQuestionMatchRefNotInPool(qs, new Set())).toBeNull();
  });
});

// ── W2 ───────────────────────────────────────────────────────────────────────

describe("resolveWeeklyEditState / structural policy", () => {
  it("resolves the most-locking state", () => {
    expect(resolveWeeklyEditState({ drafts: 0, submitted: 0, scores: 0 })).toBe("unused");
    expect(resolveWeeklyEditState({ drafts: 3, submitted: 0, scores: 0 })).toBe("has_drafts");
    expect(resolveWeeklyEditState({ drafts: 3, submitted: 2, scores: 0 })).toBe("has_submissions");
    expect(resolveWeeklyEditState({ drafts: 3, submitted: 2, scores: 1 })).toBe("has_scores");
  });

  it("allows structural edits only when unused", () => {
    expect(weeklyEditStateAllowsStructural("unused")).toBe(true);
    expect(weeklyEditStateAllowsStructural("has_drafts")).toBe(false);
    expect(weeklyEditStateAllowsStructural("has_submissions")).toBe(false);
    expect(weeklyEditStateAllowsStructural("has_scores")).toBe(false);
  });
});

function struct(over: Partial<WeeklyQuestionStructure> = {}): WeeklyQuestionStructure {
  return {
    question_key: over.question_key ?? "match_of_week",
    question_type: over.question_type ?? "single_select",
    status: over.status ?? "active",
    title: over.title ?? "Кто победит?",
    description: over.description ?? null,
    sort_order: over.sort_order ?? 1,
    options: over.options ?? [{ id: "home", label: "Дома" }, { id: "away", label: "Гости" }],
    config: over.config ?? { match_ref: "m1" },
  };
}

describe("compareWeeklyQuestionStructure", () => {
  it("title-only / description-only / sort-only = display-only", () => {
    expect(compareWeeklyQuestionStructure(struct(), struct({ title: "Новый" })).display_only).toBe(true);
    expect(compareWeeklyQuestionStructure(struct(), struct({ description: "desc" })).display_only).toBe(true);
    expect(compareWeeklyQuestionStructure(struct(), struct({ sort_order: 5 })).display_only).toBe(true);
  });

  it("no change → display_only with empty fields", () => {
    const d = compareWeeklyQuestionStructure(struct(), struct());
    expect(d.changed_fields).toEqual([]);
    expect(d.structural).toBe(false);
  });

  it("option label change = structural", () => {
    const d = compareWeeklyQuestionStructure(struct(), struct({ options: [{ id: "home", label: "X" }, { id: "away", label: "Гости" }] }));
    expect(d.structural).toBe(true);
    expect(d.structural_fields).toContain("option_labels");
  });

  it("option id change = structural", () => {
    const d = compareWeeklyQuestionStructure(struct(), struct({ options: [{ id: "h", label: "Дома" }, { id: "away", label: "Гости" }] }));
    expect(d.structural).toBe(true);
    expect(d.structural_fields).toContain("option_ids");
  });

  it("option add/remove = structural", () => {
    const more = struct({ options: [{ id: "home", label: "Дома" }, { id: "draw", label: "Ничья" }, { id: "away", label: "Гости" }] });
    expect(compareWeeklyQuestionStructure(struct(), more).structural).toBe(true);
  });

  it("question_type / status change = structural", () => {
    expect(compareWeeklyQuestionStructure(struct(), struct({ question_type: "number" })).structural).toBe(true);
    expect(compareWeeklyQuestionStructure(struct(), struct({ status: "void" })).structural_fields).toContain("status");
  });

  it("config.match_ref change = structural (ignores key order)", () => {
    expect(compareWeeklyQuestionStructure(struct(), struct({ config: { match_ref: "m2" } })).structural).toBe(true);
    // same config, different key order → not changed
    expect(compareWeeklyQuestionStructure(
      struct({ config: { a: 1, match_ref: "m1" } }),
      struct({ config: { match_ref: "m1", a: 1 } }),
    ).structural).toBe(false);
  });
});

describe("weeklyOfficialAnswerStillValid", () => {
  it("confirmed option still present → valid", () => {
    expect(weeklyOfficialAnswerStillValid("confirmed", "home", ["home", "away"])).toBe(true);
  });
  it("confirmed option removed → invalid", () => {
    expect(weeklyOfficialAnswerStillValid("confirmed", "home", ["draw", "away"])).toBe(false);
  });
  it("confirmed without an option → invalid", () => {
    expect(weeklyOfficialAnswerStillValid("confirmed", null, ["home"])).toBe(false);
  });
  it("pending and void are unaffected", () => {
    expect(weeklyOfficialAnswerStillValid("pending", null, [])).toBe(true);
    expect(weeklyOfficialAnswerStillValid("void", "gone", [])).toBe(true);
  });
});

// ── W4 ───────────────────────────────────────────────────────────────────────

describe("canRecalcWeeklyChallenge", () => {
  it("allows locked / scoring / completed", () => {
    expect(canRecalcWeeklyChallenge("locked")).toBe(true);
    expect(canRecalcWeeklyChallenge("scoring")).toBe(true);
    expect(canRecalcWeeklyChallenge("completed")).toBe(true);
  });
  it("rejects active / draft / archived", () => {
    expect(canRecalcWeeklyChallenge("active")).toBe(false);
    expect(canRecalcWeeklyChallenge("draft")).toBe(false);
    expect(canRecalcWeeklyChallenge("archived")).toBe(false);
  });
});

describe("weeklyRecalcFinalStatus", () => {
  it("clean run → completed", () => {
    expect(weeklyRecalcFinalStatus({ failed: 0 })).toBe("completed");
  });
  it("partial failure → stays scoring", () => {
    expect(weeklyRecalcFinalStatus({ failed: 3 })).toBe("scoring");
  });
});

describe("isWeeklyRecalcRunningStale", () => {
  it("fresh running run is not stale", () => {
    expect(isWeeklyRecalcRunningStale(1000, 1100, 600)).toBe(false);
  });
  it("old running run is stale (timed out)", () => {
    expect(isWeeklyRecalcRunningStale(1000, 2000, 600)).toBe(true);
  });
  it("missing started_at is treated as stale", () => {
    expect(isWeeklyRecalcRunningStale(null, 1000)).toBe(true);
  });
});

describe("weeklyChallengeResultsAreStale", () => {
  it("no scores → not stale", () => {
    expect(weeklyChallengeResultsAreStale({ officialUpdatedAt: 50, lastRecalcAt: null, hasScores: false })).toBe(false);
  });
  it("scores but no recalc log → stale", () => {
    expect(weeklyChallengeResultsAreStale({ officialUpdatedAt: null, lastRecalcAt: null, hasScores: true })).toBe(true);
  });
  it("official changed after last recalc → stale", () => {
    expect(weeklyChallengeResultsAreStale({ officialUpdatedAt: 200, lastRecalcAt: 100, hasScores: true })).toBe(true);
  });
  it("official before/at last recalc → current", () => {
    expect(weeklyChallengeResultsAreStale({ officialUpdatedAt: 100, lastRecalcAt: 200, hasScores: true })).toBe(false);
    expect(weeklyChallengeResultsAreStale({ officialUpdatedAt: null, lastRecalcAt: 200, hasScores: true })).toBe(false);
  });
});
