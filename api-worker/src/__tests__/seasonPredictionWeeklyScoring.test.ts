import { describe, it, expect } from "vitest";
import {
  scoreWeeklyChallengeEntry,
  validateWeeklyOfficialAnswers,
  weeklyChallengeHasPendingOfficial,
  WEEKLY_CHALLENGE_FORMULA_VERSION,
  type WeeklyQuestionInput,
} from "../seasonPredictionWeeklyScoring";

const KEYS = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"] as const;

function q(i: number, partial: Partial<WeeklyQuestionInput> = {}): WeeklyQuestionInput {
  return {
    id: i + 1,
    question_key: KEYS[i],
    title: `Q${i + 1}`,
    status: "active",
    options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    official_status: "confirmed",
    official_answer_option_id: "a",
    official_note: null,
    ...partial,
  };
}

describe("scoreWeeklyChallengeEntry — weekly_challenge_v1", () => {
  it("5/5 correct → 5 / 5", () => {
    const questions = [0, 1, 2, 3, 4].map((i) => q(i));
    const answers = Object.fromEntries(KEYS.map((k) => [k, "a"]));
    const res = scoreWeeklyChallengeEntry({ questions, answers });
    expect(res.formula_version).toBe(WEEKLY_CHALLENGE_FORMULA_VERSION);
    expect(res.total_points).toBe(5);
    expect(res.max_possible_points).toBe(5);
    expect(res.correct_answers).toBe(5);
    expect(res.points_pct).toBe(1);
  });

  it("3/5 correct → 3 / 5 with 2 wrong", () => {
    const questions = [0, 1, 2, 3, 4].map((i) => q(i));
    const answers = { match_of_week: "a", league_of_week: "a", duel_of_week: "a", upset_of_week: "b", event_of_week: "b" };
    const res = scoreWeeklyChallengeEntry({ questions, answers });
    expect(res.total_points).toBe(3);
    expect(res.max_possible_points).toBe(5);
    expect(res.correct_answers).toBe(3);
    expect(res.wrong_answers).toBe(2);
    expect(res.points_pct).toBe(0.6);
  });

  it("void question reduces max to 4 and is excluded", () => {
    const questions = [q(0, { official_status: "void", official_answer_option_id: null }), q(1), q(2), q(3), q(4)];
    const answers = Object.fromEntries(KEYS.map((k) => [k, "a"]));
    const res = scoreWeeklyChallengeEntry({ questions, answers });
    expect(res.max_possible_points).toBe(4);
    expect(res.total_points).toBe(4);
    expect(res.void_questions).toBe(1);
    const voidQ = (res.breakdown as any).questions.find((x: any) => x.question_key === "match_of_week");
    expect(voidQ.status).toBe("void");
  });

  it("disabled question is fully ignored (not in max, not in breakdown)", () => {
    const questions = [q(0, { status: "disabled" }), q(1), q(2), q(3), q(4)];
    const answers = Object.fromEntries(KEYS.map((k) => [k, "a"]));
    const res = scoreWeeklyChallengeEntry({ questions, answers });
    expect(res.max_possible_points).toBe(4);
    expect((res.breakdown as any).questions.find((x: any) => x.question_key === "match_of_week")).toBeUndefined();
  });

  it("unanswered confirmed question counts in max, 0 points", () => {
    const questions = [q(0), q(1)];
    const answers = { match_of_week: "a" }; // league_of_week unanswered
    const res = scoreWeeklyChallengeEntry({ questions, answers });
    expect(res.max_possible_points).toBe(2);
    expect(res.total_points).toBe(1);
    expect(res.unanswered_questions).toBe(1);
    const u = (res.breakdown as any).questions.find((x: any) => x.question_key === "league_of_week");
    expect(u.status).toBe("unanswered");
  });

  it("pending official → excluded from max + flagged; gate detects pending", () => {
    const questions = [q(0, { official_status: "pending", official_answer_option_id: null }), q(1)];
    expect(weeklyChallengeHasPendingOfficial(questions)).toBe(true);
    const res = scoreWeeklyChallengeEntry({ questions, answers: { match_of_week: "a", league_of_week: "a" } });
    expect(res.max_possible_points).toBe(1); // only the confirmed q1
    const p = (res.breakdown as any).questions.find((x: any) => x.question_key === "match_of_week");
    expect(p.status).toBe("pending_official");
  });

  it("an unknown user option is treated as wrong (safe)", () => {
    const res = scoreWeeklyChallengeEntry({ questions: [q(0)], answers: { match_of_week: "ghost" } });
    expect(res.total_points).toBe(0);
    expect(res.wrong_answers).toBe(1);
  });

  it("no pending when all active questions are confirmed/void", () => {
    const questions = [q(0), q(1, { official_status: "void", official_answer_option_id: null }), q(2, { status: "disabled" })];
    expect(weeklyChallengeHasPendingOfficial(questions)).toBe(false);
  });
});

describe("validateWeeklyOfficialAnswers", () => {
  const questions = [q(0), q(1)];
  it("accepts confirmed with valid option and void with null", () => {
    const out = validateWeeklyOfficialAnswers([
      { question_id: 1, official_status: "confirmed", official_answer_option_id: "b" },
      { question_id: 2, official_status: "void", official_answer_option_id: null, official_note: "Матч отменён" },
    ], questions);
    expect(out[0]).toMatchObject({ question_id: 1, official_status: "confirmed", official_answer_option_id: "b" });
    expect(out[1]).toMatchObject({ question_id: 2, official_status: "void", official_answer_option_id: null });
  });
  it("rejects confirmed without an option", () => {
    expect(() => validateWeeklyOfficialAnswers([{ question_id: 1, official_status: "confirmed", official_answer_option_id: null }], questions)).toThrow("WEEKLY_OFFICIAL_OPTION_REQUIRED");
  });
  it("rejects an option not belonging to the question", () => {
    expect(() => validateWeeklyOfficialAnswers([{ question_id: 1, official_status: "confirmed", official_answer_option_id: "zzz" }], questions)).toThrow("WEEKLY_OFFICIAL_OPTION_INVALID");
  });
  it("rejects an unknown question", () => {
    expect(() => validateWeeklyOfficialAnswers([{ question_id: 999, official_status: "void" }], questions)).toThrow("WEEKLY_QUESTION_NOT_IN_CHALLENGE");
  });
  it("rejects an invalid status", () => {
    expect(() => validateWeeklyOfficialAnswers([{ question_id: 1, official_status: "maybe" }], questions)).toThrow("WEEKLY_OFFICIAL_STATUS_INVALID");
  });
});

// Multi-answer support: upset-family questions can have several correct options
// (e.g. two favourites drop points in the same round).
describe("multiple correct answers", () => {
  const multiQ = (partial: Partial<WeeklyQuestionInput> = {}): WeeklyQuestionInput => q(3, {
    options: [{ id: "upset_1", label: "Реал" }, { id: "upset_2", label: "Наполи" }, { id: "no_upset", label: "Все победят" }],
    official_answer_option_id: "upset_1",
    official_answer_option_ids: ["upset_1", "upset_2"],
    allow_multi_correct: true,
    ...partial,
  });

  it("accepts every listed option as correct", () => {
    const first = scoreWeeklyChallengeEntry({ questions: [multiQ()], answers: { upset_of_week: "upset_1" } });
    const second = scoreWeeklyChallengeEntry({ questions: [multiQ()], answers: { upset_of_week: "upset_2" } });
    expect(first.total_points).toBe(1);
    expect(second.total_points).toBe(1);
    expect(second.correct_answers).toBe(1);
  });

  it("still marks an option outside the accepted set as wrong", () => {
    const res = scoreWeeklyChallengeEntry({ questions: [multiQ()], answers: { upset_of_week: "no_upset" } });
    expect(res.total_points).toBe(0);
    expect(res.wrong_answers).toBe(1);
  });

  it("shows the whole accepted set in the breakdown", () => {
    const res = scoreWeeklyChallengeEntry({ questions: [multiQ()], answers: { upset_of_week: "upset_2" } });
    const row = (res.breakdown as any).questions[0];
    expect(row.official_answer_option_ids).toEqual(["upset_1", "upset_2"]);
    expect(row.official_answer_label).toBe("Реал / Наполи");
  });

  it("legacy single-answer questions are unaffected", () => {
    const res = scoreWeeklyChallengeEntry({ questions: [q(0)], answers: { match_of_week: "b" } });
    expect(res.total_points).toBe(0);
    const row = (res.breakdown as any).questions[0];
    expect(row.official_answer_option_ids).toEqual(["a"]);
    expect(row.official_answer_label).toBe("A");
  });

  it("validation accepts several ids for a multi-capable question", () => {
    const out = validateWeeklyOfficialAnswers(
      [{ question_id: 4, official_status: "confirmed", official_answer_option_ids: ["upset_1", "upset_2"] }],
      [multiQ({ official_answer_option_id: null, official_answer_option_ids: null })],
    );
    expect(out[0].official_answer_option_ids).toEqual(["upset_1", "upset_2"]);
    expect(out[0].official_answer_option_id).toBe("upset_1");
  });

  it("validation rejects several ids for a single-answer question", () => {
    expect(() => validateWeeklyOfficialAnswers(
      [{ question_id: 1, official_status: "confirmed", official_answer_option_ids: ["a", "b"] }],
      [q(0)],
    )).toThrow("WEEKLY_OFFICIAL_MULTI_NOT_ALLOWED");
  });

  it("validation rejects duplicates and unknown ids", () => {
    expect(() => validateWeeklyOfficialAnswers(
      [{ question_id: 4, official_status: "confirmed", official_answer_option_ids: ["upset_1", "upset_1"] }],
      [multiQ()],
    )).toThrow("WEEKLY_OFFICIAL_OPTIONS_DUPLICATE");
    expect(() => validateWeeklyOfficialAnswers(
      [{ question_id: 4, official_status: "confirmed", official_answer_option_ids: ["upset_1", "ghost"] }],
      [multiQ()],
    )).toThrow("WEEKLY_OFFICIAL_OPTION_INVALID");
  });

  it("void clears both the single and the multi answer", () => {
    const out = validateWeeklyOfficialAnswers(
      [{ question_id: 4, official_status: "void", official_answer_option_ids: ["upset_1", "upset_2"] }],
      [multiQ()],
    );
    expect(out[0].official_answer_option_id).toBeNull();
    expect(out[0].official_answer_option_ids).toBeNull();
  });
});
