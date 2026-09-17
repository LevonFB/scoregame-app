import { describe, expect, it } from "vitest";
import {
  canEditWeeklyEntry,
  canSubmitWeeklyEntry,
  resolveWeeklyUserState,
  weeklyActiveQuestionsInOrder,
  weeklyProgress,
} from "../seasonPredictionWeeklyFlow";

describe("weeklyActiveQuestionsInOrder", () => {
  it("keeps only active questions, sorted by sort_order then id", () => {
    const out = weeklyActiveQuestionsInOrder([
      { question_key: "c", status: "active", sort_order: 3, id: 3 },
      { question_key: "void", status: "void", sort_order: 1, id: 9 },
      { question_key: "a", status: "active", sort_order: 1, id: 1 },
      { question_key: "disabled", status: "disabled", sort_order: 2, id: 8 },
      { question_key: "b", status: "active", sort_order: 2, id: 2 },
    ]);
    expect(out.map((q) => q.question_key)).toEqual(["a", "b", "c"]);
  });

  it("handles an empty list", () => {
    expect(weeklyActiveQuestionsInOrder([])).toEqual([]);
  });
});

describe("weeklyProgress", () => {
  const qs = [
    { question_key: "a", status: "active" },
    { question_key: "b", status: "active" },
    { question_key: "c", status: "active" },
  ];

  it("0/N when no answers", () => {
    const p = weeklyProgress(qs, {});
    expect(p).toEqual({ answered: 0, total: 3, allAnswered: false });
  });

  it("counts partial answers and ignores empty strings", () => {
    expect(weeklyProgress(qs, { a: "home", b: "" }).answered).toBe(1);
  });

  it("N/N when all answered", () => {
    expect(weeklyProgress(qs, { a: "1", b: "2", c: "3" })).toEqual({ answered: 3, total: 3, allAnswered: true });
  });

  it("allAnswered is false for an empty question set", () => {
    expect(weeklyProgress([], {}).allAnswered).toBe(false);
  });
});

describe("canSubmitWeeklyEntry / canEditWeeklyEntry", () => {
  const base = { allAnswered: true, isSubmitting: false, locked: false, deadlinePassed: false, hasScore: false };

  it("complete + editable → allowed", () => {
    expect(canSubmitWeeklyEntry(base)).toBe(true);
  });
  it("incomplete → blocked", () => {
    expect(canSubmitWeeklyEntry({ ...base, allAnswered: false })).toBe(false);
  });
  it("in-flight → blocked", () => {
    expect(canSubmitWeeklyEntry({ ...base, isSubmitting: true })).toBe(false);
  });
  it("locked / deadline passed / has score → blocked", () => {
    expect(canSubmitWeeklyEntry({ ...base, locked: true })).toBe(false);
    expect(canSubmitWeeklyEntry({ ...base, deadlinePassed: true })).toBe(false);
    expect(canSubmitWeeklyEntry({ ...base, hasScore: true })).toBe(false);
  });
  it("canEdit mirrors lock/deadline/score", () => {
    expect(canEditWeeklyEntry({ locked: false, deadlinePassed: false, hasScore: false })).toBe(true);
    expect(canEditWeeklyEntry({ locked: false, deadlinePassed: true, hasScore: false })).toBe(false);
  });
});

describe("resolveWeeklyUserState", () => {
  const base = { challengeStatus: "active", entryStatus: null, deadlinePassed: false, hasScore: false, openAt: null, nowSeconds: 1000 };

  it("has_score wins over everything", () => {
    expect(resolveWeeklyUserState({ ...base, hasScore: true, challengeStatus: "active", entryStatus: "submitted" })).toBe("has_score");
  });
  it("draft challenge → before_open", () => {
    expect(resolveWeeklyUserState({ ...base, challengeStatus: "draft" })).toBe("before_open");
  });
  it("open_at in the future → before_open", () => {
    expect(resolveWeeklyUserState({ ...base, openAt: 2000, nowSeconds: 1000 })).toBe("before_open");
  });
  it("active intake, no submission → active", () => {
    expect(resolveWeeklyUserState(base)).toBe("active");
  });
  it("submitted before deadline → submitted_editable", () => {
    expect(resolveWeeklyUserState({ ...base, entryStatus: "submitted" })).toBe("submitted_editable");
  });
  it("deadline passed → locked", () => {
    expect(resolveWeeklyUserState({ ...base, deadlinePassed: true, entryStatus: "submitted" })).toBe("locked");
  });
  it("scoring / completed map through", () => {
    expect(resolveWeeklyUserState({ ...base, challengeStatus: "scoring" })).toBe("scoring");
    expect(resolveWeeklyUserState({ ...base, challengeStatus: "completed" })).toBe("completed");
  });
  it("locked/archived challenge → locked", () => {
    expect(resolveWeeklyUserState({ ...base, challengeStatus: "archived" })).toBe("locked");
  });
});
