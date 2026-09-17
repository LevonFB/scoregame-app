import { describe, it, expect } from "vitest";
import {
  aggregateEurocupOverall,
  compareEurocupOverall,
  compareEurocupPerCup,
  extractEurocupMetricsFromBreakdown,
  type EurocupMetricRow,
  type RawEurocupScoreRow,
} from "../seasonPredictionEurocupLeaderboard";

function row(p: Partial<EurocupMetricRow> & { user_id: number }): EurocupMetricRow {
  return {
    total_points: 0,
    max_possible_points: 188,
    top8_correct: 0,
    playoff_9_24_correct: 0,
    top24_correct: 0,
    bonus_points: 0,
    last_submitted_at: null,
    scored_at: null,
    ...p,
  };
}
function order(rows: EurocupMetricRow[], cmp: (a: EurocupMetricRow, b: EurocupMetricRow) => number) {
  return [...rows].sort(cmp).map((r) => r.user_id);
}

describe("extractEurocupMetricsFromBreakdown", () => {
  it("reads summary metrics and sums earned bonuses", () => {
    const m = extractEurocupMetricsFromBreakdown({
      summary: { top8_correct: 8, playoff_9_24_correct: 16, top24_correct: 24 },
      bonuses: [
        { key: "all_top8_correct", earned: true, points: 20 },
        { key: "all_9_24_correct", earned: false, points: 20 },
        { key: "all_top24_correct", earned: true, points: 20 },
      ],
    });
    expect(m).toEqual({ top8_correct: 8, playoff_9_24_correct: 16, top24_correct: 24, bonus_points: 40 });
  });

  it("falls back to 0 on missing/broken breakdown", () => {
    expect(extractEurocupMetricsFromBreakdown(null)).toEqual({ top8_correct: 0, playoff_9_24_correct: 0, top24_correct: 0, bonus_points: 0 });
    expect(extractEurocupMetricsFromBreakdown("garbage")).toEqual({ top8_correct: 0, playoff_9_24_correct: 0, top24_correct: 0, bonus_points: 0 });
    expect(extractEurocupMetricsFromBreakdown({ summary: {} })).toEqual({ top8_correct: 0, playoff_9_24_correct: 0, top24_correct: 0, bonus_points: 0 });
  });
});

describe("compareEurocupPerCup", () => {
  it("sorts by total_points DESC first", () => {
    expect(order([row({ user_id: 1, total_points: 100 }), row({ user_id: 2, total_points: 188 })], compareEurocupPerCup)).toEqual([2, 1]);
  });
  it("breaks ties by top24_correct, then top8, then 9_24, then bonus", () => {
    const rows = [
      row({ user_id: 1, total_points: 100, top24_correct: 20, top8_correct: 5, playoff_9_24_correct: 10, bonus_points: 0 }),
      row({ user_id: 2, total_points: 100, top24_correct: 24, top8_correct: 1, playoff_9_24_correct: 1, bonus_points: 0 }),
      row({ user_id: 3, total_points: 100, top24_correct: 20, top8_correct: 8, playoff_9_24_correct: 1, bonus_points: 0 }),
    ];
    // 2 wins on top24; then 3 beats 1 on top8.
    expect(order(rows, compareEurocupPerCup)).toEqual([2, 3, 1]);
  });
  it("breaks a pure 9_24 tie, then bonus", () => {
    const a = row({ user_id: 1, total_points: 50, top24_correct: 10, top8_correct: 4, playoff_9_24_correct: 6, bonus_points: 0 });
    const b = row({ user_id: 2, total_points: 50, top24_correct: 10, top8_correct: 4, playoff_9_24_correct: 8, bonus_points: 0 });
    expect(order([a, b], compareEurocupPerCup)).toEqual([2, 1]);
    const c = row({ user_id: 3, total_points: 50, top24_correct: 10, top8_correct: 4, playoff_9_24_correct: 6, bonus_points: 20 });
    expect(order([a, c], compareEurocupPerCup)).toEqual([3, 1]);
  });
  it("puts missing last_submitted_at last, then user_id ASC", () => {
    const rows = [
      row({ user_id: 9, total_points: 50, last_submitted_at: 1000 }),
      row({ user_id: 2, total_points: 50, last_submitted_at: 1000 }),
      row({ user_id: 5, total_points: 50, last_submitted_at: null }),
    ];
    expect(order(rows, compareEurocupPerCup)).toEqual([2, 9, 5]);
  });
});

describe("compareEurocupOverall", () => {
  it("ranks coverage after the accuracy chain", () => {
    const rows = [
      row({ user_id: 1, total_points: 200, top24_correct: 30, scored_cups_count: 3 }),
      row({ user_id: 2, total_points: 200, top24_correct: 30, scored_cups_count: 1 }),
    ];
    expect(order(rows, compareEurocupOverall)).toEqual([1, 2]);
  });
});

describe("aggregateEurocupOverall", () => {
  function raw(p: Partial<RawEurocupScoreRow> & { user_id: number; tournament_code: string }): RawEurocupScoreRow {
    return { total_points: 0, max_possible_points: 188, top8_correct: 0, playoff_9_24_correct: 0, top24_correct: 0, bonus_points: 0, last_submitted_at: null, scored_at: null, ...p };
  }
  it("partial coverage: one cup scored → scored_cups_count 1", () => {
    const out = aggregateEurocupOverall([raw({ user_id: 7, tournament_code: "UCL", total_points: 188, top24_correct: 24, scored_at: 1000 })]);
    expect(out).toHaveLength(1);
    expect(out[0].scored_cups_count).toBe(1);
    expect(out[0].total_points).toBe(188);
  });
  it("sums across cups and counts distinct codes (2/3)", () => {
    const out = aggregateEurocupOverall([
      raw({ user_id: 7, tournament_code: "UCL", total_points: 188, max_possible_points: 188, top8_correct: 8, scored_at: 1000, last_submitted_at: 900 }),
      raw({ user_id: 7, tournament_code: "UEL", total_points: 100, max_possible_points: 188, top8_correct: 4, scored_at: 1200, last_submitted_at: 1100 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scored_cups_count).toBe(2);
    expect(out[0].total_points).toBe(288);
    expect(out[0].max_possible_points).toBe(376);
    expect(out[0].top8_correct).toBe(12);
    expect(out[0].scored_at).toBe(1200);
    expect(out[0].last_submitted_at).toBe(1100);
  });
  it("groups users separately; empty input → []", () => {
    expect(aggregateEurocupOverall([])).toEqual([]);
    const out = aggregateEurocupOverall([
      raw({ user_id: 1, tournament_code: "UCL", total_points: 50 }),
      raw({ user_id: 2, tournament_code: "UCL", total_points: 90 }),
    ]);
    expect(out).toHaveLength(2);
  });
});
