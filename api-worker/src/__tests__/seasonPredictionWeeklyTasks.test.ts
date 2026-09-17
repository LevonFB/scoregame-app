import { describe, it, expect } from "vitest";
import {
  buildWeeklyChallengeTasksForUser,
  assertWeeklyTaskConfigChangeAllowed,
  resolveWeeklyTaskForClaim,
  weeklyTaskUniqueKeyBase,
  type WeeklyTaskBuilderInput,
} from "../seasonPredictionWeeklyTasks";

const CHALLENGE = { id: 42, title: "Вызов недели #1", status: "active" };
const V2_CHALLENGE = { ...CHALLENGE, task_schema_version: 2, bonus_question_key: "upset", deadline_at: 2000 };
const QKEYS = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"];

function baseInput(overrides: Partial<WeeklyTaskBuilderInput> = {}): WeeklyTaskBuilderInput {
  return {
    userId: 100,
    seasonId: 7,
    challenge: CHALLENGE,
    entry: null,
    activeQuestionKeys: QKEYS,
    score: null,
    seasonSubmittedCount: 0,
    claimedUniqueKeys: [],
    ...overrides,
  };
}

function byKey(views: ReturnType<typeof buildWeeklyChallengeTasksForUser>, key: string) {
  const v = views.find((t) => t.key === key);
  if (!v) throw new Error(`task ${key} not found`);
  return v;
}

describe("Weekly Challenge Tasks V2", () => {
  function v2Input(overrides: Partial<WeeklyTaskBuilderInput> = {}): WeeklyTaskBuilderInput {
    return baseInput({
      challenge: V2_CHALLENGE,
      entry: { status: "submitted", submitted_at: 1500, answers: Object.fromEntries(QKEYS.map((k) => [k, "ok"])) },
      ...overrides,
    });
  }

  it("returns exactly the three V2 tasks", () => {
    const views = buildWeeklyChallengeTasksForUser(v2Input());
    expect(views.map((v) => v.key)).toEqual([
      "weekly_challenge_participation",
      "weekly_challenge_bonus",
      "weekly_challenge_result",
    ]);
    expect(byKey(views, "weekly_challenge_participation").progress).toEqual({ current: 3, target: 3 });
  });

  it("participation is claimable only after start, all answers and submit before deadline", () => {
    const partial = buildWeeklyChallengeTasksForUser(v2Input({
      entry: { status: "draft", submitted_at: null, answers: { match_of_week: "ok" } },
    }));
    expect(byKey(partial, "weekly_challenge_participation").status).toBe("in_progress");
    expect(byKey(partial, "weekly_challenge_participation").progress).toEqual({ current: 1, target: 3 });

    const done = buildWeeklyChallengeTasksForUser(v2Input());
    expect(byKey(done, "weekly_challenge_participation").status).toBe("claimable");
  });

  it("bonus waits, claimable on correct, failed on wrong, void on void", () => {
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input()), "weekly_challenge_bonus").status).toBe("waiting_results");
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input({
      score: { total_points: 1, max_possible_points: 1, correct_answers: 1 },
      questionResults: { upset_of_week: { status: "correct", points: 1 } },
    })), "weekly_challenge_bonus").status).toBe("claimable");
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input({
      score: { total_points: 0, max_possible_points: 1, correct_answers: 0 },
      questionResults: { upset_of_week: { status: "wrong", points: 0 } },
    })), "weekly_challenge_bonus").status).toBe("failed");
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input({
      score: { total_points: 0, max_possible_points: 0, correct_answers: 0 },
      questionResults: { upset_of_week: { status: "void", points: 0 } },
    })), "weekly_challenge_bonus").status).toBe("void");
  });

  it("result tier uses the single highest reward", () => {
    const cases = [
      [{ total_points: 4, max_possible_points: 4, correct_answers: 4 }, { tier: "perfect", stars: 5, balls: 0, case_type: "basic", case_count: 1 }],
      [{ total_points: 3, max_possible_points: 3, correct_answers: 3 }, { tier: "gold", stars: 3, balls: 1, case_type: null, case_count: 0 }],
      [{ total_points: 2, max_possible_points: 4, correct_answers: 2 }, { tier: "bronze", stars: 1, balls: 0, case_type: null, case_count: 0 }],
      [{ total_points: 3, max_possible_points: 4, correct_answers: 3 }, { tier: "silver", stars: 2, balls: 0, case_type: null, case_count: 0 }],
      [{ total_points: 2, max_possible_points: 3, correct_answers: 2 }, { tier: "silver", stars: 2, balls: 0, case_type: null, case_count: 0 }],
    ] as const;
    for (const [score, expected] of cases) {
      const task = byKey(buildWeeklyChallengeTasksForUser(v2Input({ score })), "weekly_challenge_result");
      expect(task.status).toBe("claimable");
      expect(task.meta?.tier).toBe(expected.tier);
      expect(task.reward).toMatchObject({
        stars: expected.stars,
        balls: expected.balls,
        case_type: expected.case_type,
        case_count: expected.case_count,
      });
    }
  });

  it("stale score keeps V2 result tasks waiting", () => {
    const views = buildWeeklyChallengeTasksForUser(v2Input({
      score: { total_points: 4, max_possible_points: 4, correct_answers: 4 },
      questionResults: { upset_of_week: { status: "correct", points: 1 } },
      resultsStale: true,
    }));
    expect(byKey(views, "weekly_challenge_bonus").status).toBe("waiting_results");
    expect(byKey(views, "weekly_challenge_result").status).toBe("waiting_results");
  });

  it.each([
    [0, 5, null, null],
    [1, 5, "start", { stars: 1, balls: 0, case_type: null, case_count: 0, boost_type: "double_chance", boost_count: 1 }],
    [2, 5, "bronze", { stars: 1, balls: 0, case_type: null, case_count: 0 }],
    [3, 5, "silver", { stars: 2, balls: 0, case_type: null, case_count: 0 }],
    [4, 5, "gold", { stars: 3, balls: 1, case_type: null, case_count: 0 }],
    [5, 5, "perfect", { stars: 5, balls: 0, case_type: "basic", case_count: 1 }],
    [0, 4, null, null],
    [1, 4, "start", { stars: 1, balls: 0, case_type: null, case_count: 0, boost_type: "double_chance", boost_count: 1 }],
    [2, 4, "bronze", { stars: 1, balls: 0, case_type: null, case_count: 0 }],
    [3, 4, "silver", { stars: 2, balls: 0, case_type: null, case_count: 0 }],
    [4, 4, "perfect", { stars: 5, balls: 0, case_type: "basic", case_count: 1 }],
    [0, 3, null, null],
    [1, 3, "start", { stars: 1, balls: 0, case_type: null, case_count: 0, boost_type: "double_chance", boost_count: 1 }],
    [2, 3, "silver", { stars: 2, balls: 0, case_type: null, case_count: 0 }],
    [3, 3, "gold", { stars: 3, balls: 1, case_type: null, case_count: 0 }],
    [0, 2, null, null],
    [1, 2, "bronze", { stars: 1, balls: 0, case_type: null, case_count: 0 }],
    [2, 2, "gold", { stars: 3, balls: 1, case_type: null, case_count: 0 }],
    [0, 0, null, null],
  ] as const)("tier matrix %i/%i -> %s", (total, max, tier, reward) => {
    const task = byKey(buildWeeklyChallengeTasksForUser(v2Input({
      score: { total_points: total, max_possible_points: max, correct_answers: total },
    })), "weekly_challenge_result");
    expect(task.meta?.tier ?? null).toBe(tier);
    if (reward) {
      expect(task.status).toBe("claimable");
      expect(task.reward).toMatchObject(reward);
    } else {
      expect(task.status).toBe("failed");
      expect(task.reward).toBeNull();
    }
  });

  it.each([
    ["match", "match_of_week", 2],
    ["league", "league_of_week", 2],
    ["duel", "duel_of_week", 2],
    ["upset", "upset_of_week", 2],
    ["event", "event_of_week", 2],
  ] as const)("bonus matrix for %s", (bonus, fullKey, stars) => {
    const base = { ...V2_CHALLENGE, bonus_question_key: bonus };
    const correct = byKey(buildWeeklyChallengeTasksForUser(v2Input({
      challenge: base,
      score: { total_points: 1, max_possible_points: 1, correct_answers: 1 },
      questionResults: { [fullKey]: { status: "correct", points: 1 } },
    })), "weekly_challenge_bonus");
    expect(correct.status).toBe("claimable");
    expect(correct.reward?.stars).toBe(stars);

    const wrong = byKey(buildWeeklyChallengeTasksForUser(v2Input({
      challenge: base,
      score: { total_points: 0, max_possible_points: 1, correct_answers: 0 },
      questionResults: { [fullKey]: { status: "wrong", points: 0 } },
    })), "weekly_challenge_bonus");
    expect(wrong.status).toBe("failed");

    const otherQuestionCorrect = byKey(buildWeeklyChallengeTasksForUser(v2Input({
      challenge: base,
      score: { total_points: 1, max_possible_points: 1, correct_answers: 1 },
      questionResults: { event_of_week: { status: "correct", points: 1 } },
    })), "weekly_challenge_bonus");
    if (fullKey === "event_of_week") expect(otherQuestionCorrect.status).toBe("claimable");
    else expect(otherQuestionCorrect.status).toBe("waiting_results");

    const beforeSubmit = byKey(buildWeeklyChallengeTasksForUser(v2Input({
      challenge: base,
      entry: { status: "draft", answers: Object.fromEntries(QKEYS.map((k) => [k, "ok"])) },
    })), "weekly_challenge_bonus");
    expect(beforeSubmit.status).toBe("in_progress");
  });

  it("participation flow is 0/3, 1/3, 2/3, then 3/3 claimable; late submit is not completed", () => {
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input({ entry: null })), "weekly_challenge_participation").progress).toEqual({ current: 0, target: 3 });
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input({ entry: { status: "draft", answers: {} } })), "weekly_challenge_participation").progress).toEqual({ current: 1, target: 3 });
    expect(byKey(buildWeeklyChallengeTasksForUser(v2Input({ entry: { status: "draft", answers: Object.fromEntries(QKEYS.map((k) => [k, "ok"])) } })), "weekly_challenge_participation").progress).toEqual({ current: 2, target: 3 });
    const done = byKey(buildWeeklyChallengeTasksForUser(v2Input()), "weekly_challenge_participation");
    expect(done.progress).toEqual({ current: 3, target: 3 });
    expect(done.status).toBe("claimable");
    const late = byKey(buildWeeklyChallengeTasksForUser(v2Input({ entry: { status: "submitted", submitted_at: 2500, answers: Object.fromEntries(QKEYS.map((k) => [k, "ok"])) } })), "weekly_challenge_participation");
    expect(late.status).toBe("in_progress");
    expect(late.progress).toEqual({ current: 2, target: 3 });
  });

  it("completed V2 result displays the operation snapshot, not a newly recalculated tier", () => {
    const base = `weekly_challenge_task:42:weekly_challenge_result:100`;
    const task = byKey(buildWeeklyChallengeTasksForUser(v2Input({
      score: { total_points: 5, max_possible_points: 5, correct_answers: 5 },
      claimedTaskSnapshots: {
        [base]: {
          tier: "gold",
          task_schema_version: 2,
          reward: { stars: 3, balls: 1, case_type: null, case_count: 0 },
          component_keys: [`${base}:stars`, `${base}:balls`],
        },
      },
    })), "weekly_challenge_result");
    expect(task.status).toBe("claimed");
    expect(task.meta?.tier).toBe("gold");
    expect(task.reward).toMatchObject({ stars: 3, balls: 1, case_type: null, case_count: 0 });
  });
});

describe("weeklyTaskUniqueKeyBase", () => {
  it("per-challenge key omits volatile fields", () => {
    const base = weeklyTaskUniqueKeyBase(
      { key: "weekly_challenge_result", scope: "current_weekly_challenge" },
      { challengeId: 42, seasonId: 7, userId: 100 },
    );
    expect(base).toBe("weekly_challenge_task:42:weekly_challenge_result:100");
  });

  it("season-scope key uses season id, ignores challenge", () => {
    const base = weeklyTaskUniqueKeyBase(
      { key: "weekly_challenge_participation", scope: "season_weekly_challenge" },
      { challengeId: null, seasonId: 7, userId: 100 },
    );
    expect(base).toBe("weekly_challenge_task:season:7:weekly_challenge_participation:100");
  });

  it("per-challenge key is null without a challenge", () => {
    const base = weeklyTaskUniqueKeyBase(
      { key: "weekly_challenge_participation", scope: "current_weekly_challenge" },
      { challengeId: null, seasonId: 7, userId: 100 },
    );
    expect(base).toBeNull();
  });
});

describe("Weekly task schema immutability guard", () => {
  const base = {
    currentStatus: "draft",
    currentTaskSchemaVersion: 2,
    currentBonusQuestionKey: "upset",
    requestedTaskSchemaVersion: 2,
    requestedBonusQuestionKey: "event",
    entryCount: 0,
  };

  it("draft V2 without entries can change bonus question", () => {
    expect(assertWeeklyTaskConfigChangeAllowed(base)).toEqual({ task_schema_version: 2, bonus_question_key: "event" });
  });

  it("draft without entries can change schema version when explicitly requested", () => {
    expect(assertWeeklyTaskConfigChangeAllowed({ ...base, currentTaskSchemaVersion: 1, currentBonusQuestionKey: null, requestedTaskSchemaVersion: 2, requestedBonusQuestionKey: "match" }))
      .toEqual({ task_schema_version: 2, bonus_question_key: "match" });
  });

  it("after first entry schema version and bonus question are locked", () => {
    expect(() => assertWeeklyTaskConfigChangeAllowed({ ...base, entryCount: 1 })).toThrow("WEEKLY_TASK_SCHEMA_LOCKED_AFTER_ENTRIES_OR_PUBLISH");
    expect(() => assertWeeklyTaskConfigChangeAllowed({ ...base, requestedTaskSchemaVersion: 1, requestedBonusQuestionKey: null, entryCount: 1 })).toThrow("WEEKLY_TASK_SCHEMA_LOCKED_AFTER_ENTRIES_OR_PUBLISH");
  });

  it.each(["active", "locked", "scoring", "completed", "archived"])("%s challenge cannot change schema or bonus", (status) => {
    expect(() => assertWeeklyTaskConfigChangeAllowed({ ...base, currentStatus: status })).toThrow("WEEKLY_TASK_SCHEMA_LOCKED_AFTER_ENTRIES_OR_PUBLISH");
  });

  it("legacy V1 config normalizes to no bonus (read-path tolerance)", () => {
    expect(assertWeeklyTaskConfigChangeAllowed({ ...base, currentTaskSchemaVersion: 1, currentBonusQuestionKey: "upset", requestedTaskSchemaVersion: 1, requestedBonusQuestionKey: "event" }))
      .toEqual({ task_schema_version: 1, bonus_question_key: null });
  });

  it("V2 without valid bonus question is rejected", () => {
    expect(() => assertWeeklyTaskConfigChangeAllowed({ ...base, requestedBonusQuestionKey: null })).toThrow("WEEKLY_V2_BONUS_QUESTION_REQUIRED");
    expect(() => assertWeeklyTaskConfigChangeAllowed({ ...base, requestedBonusQuestionKey: "nope" })).toThrow("WEEKLY_V2_BONUS_QUESTION_REQUIRED");
  });
});

describe("resolveWeeklyTaskForClaim", () => {
  const submittedEntry = { status: "submitted", submitted_at: 1500, answers: Object.fromEntries(QKEYS.map((k) => [k, "ok"])) };
  function v2(overrides: Partial<WeeklyTaskBuilderInput> = {}): WeeklyTaskBuilderInput {
    return baseInput({ challenge: V2_CHALLENGE, entry: submittedEntry, ...overrides });
  }

  it("returns a claimable participation task with a stable base", () => {
    const res = resolveWeeklyTaskForClaim("weekly_challenge_participation", v2());
    expect(res).not.toBeNull();
    expect(res!.view.claimable).toBe(true);
    expect(res!.base).toBe("weekly_challenge_task:42:weekly_challenge_participation:100");
    expect(res!.def.reward?.stars).toBe(2);
  });

  it("returns the task even when not yet completed (caller rejects)", () => {
    const res = resolveWeeklyTaskForClaim("weekly_challenge_participation", v2({ entry: null }));
    expect(res).not.toBeNull();
    expect(res!.view.claimable).toBe(false);
    expect(res!.view.status).toBe("in_progress");
  });

  it("unknown task key → null", () => {
    expect(resolveWeeklyTaskForClaim("nope", v2())).toBeNull();
  });

  it("a result task below any tier resolves as non-claimable (claim endpoint rejects, grants nothing)", () => {
    const res = resolveWeeklyTaskForClaim("weekly_challenge_result", v2({
      score: { total_points: 0, max_possible_points: 5, correct_answers: 0 },
    }));
    expect(res).not.toBeNull();
    expect(res!.view.status).toBe("failed");
    expect(res!.view.claimable).toBe(false);
  });

  it("rejects a result task when results are stale", () => {
    const res = resolveWeeklyTaskForClaim("weekly_challenge_result", v2({
      score: { total_points: 5, max_possible_points: 5, correct_answers: 5 },
      resultsStale: true,
    }));
    expect(res).not.toBeNull();
    expect(res!.view.status).toBe("waiting_results");
    expect(res!.view.claimable).toBe(false);
  });
});
