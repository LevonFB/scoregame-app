import { describe, it, expect } from "vitest";
import {
  aggregateSeasonOverallLeaderboard,
  compareSeasonOverall,
  deriveSeasonOverallEmptyReason,
  seasonGroupOfCode,
  SEASON_OVERALL_MAX_TOURNAMENTS,
  type RawSeasonScoreRow,
  type SeasonOverallRow,
} from "../seasonPredictionOverallLeaderboard";

function raw(p: Partial<RawSeasonScoreRow> & { user_id: number; tournament_code: string }): RawSeasonScoreRow {
  return { total_points: 0, max_possible_points: 0, last_submitted_at: null, scored_at: null, ...p };
}
function srow(p: Partial<SeasonOverallRow> & { user_id: number }): SeasonOverallRow {
  return {
    total_points: 0, max_possible_points: 0,
    top5_points: 0, top5_max_points: 0, top5_scored_count: 0,
    eurocups_points: 0, eurocups_max_points: 0, eurocups_scored_count: 0,
    scored_total_count: 0, last_submitted_at: null, scored_at: null, ...p,
  };
}
function order(rows: SeasonOverallRow[]) {
  return [...rows].sort(compareSeasonOverall).map((r) => r.user_id);
}

describe("seasonGroupOfCode", () => {
  it("classifies top5 / eurocups / other", () => {
    expect(seasonGroupOfCode("PL")).toBe("top5");
    expect(seasonGroupOfCode("FL1")).toBe("top5");
    expect(seasonGroupOfCode("UCL")).toBe("eurocups");
    expect(seasonGroupOfCode("UECL")).toBe("eurocups");
    expect(seasonGroupOfCode("WEEKLY")).toBeNull();
  });
  it("max tournaments is 8", () => {
    expect(SEASON_OVERALL_MAX_TOURNAMENTS).toBe(8);
  });
});

describe("aggregateSeasonOverallLeaderboard", () => {
  it("only top5 scores → user appears with eurocups 0", () => {
    const out = aggregateSeasonOverallLeaderboard([
      raw({ user_id: 1, tournament_code: "PL", total_points: 100, max_possible_points: 163 }),
      raw({ user_id: 1, tournament_code: "PD", total_points: 90, max_possible_points: 163 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].top5_points).toBe(190);
    expect(out[0].top5_scored_count).toBe(2);
    expect(out[0].eurocups_points).toBe(0);
    expect(out[0].eurocups_scored_count).toBe(0);
    expect(out[0].total_points).toBe(190);
    expect(out[0].scored_total_count).toBe(2);
  });

  it("only eurocup scores → user appears with top5 0", () => {
    const out = aggregateSeasonOverallLeaderboard([
      raw({ user_id: 1, tournament_code: "UCL", total_points: 188, max_possible_points: 188 }),
    ]);
    expect(out[0].eurocups_points).toBe(188);
    expect(out[0].eurocups_scored_count).toBe(1);
    expect(out[0].top5_points).toBe(0);
    expect(out[0].total_points).toBe(188);
    expect(out[0].scored_total_count).toBe(1);
  });

  it("top5 + eurocups sum correctly (example data)", () => {
    const rows: RawSeasonScoreRow[] = [
      ...["PL", "PD", "SA", "BL1", "FL1"].map((c, i) => raw({ user_id: 7, tournament_code: c, total_points: [200, 150, 140, 100, 100][i], max_possible_points: [163, 163, 163, 152, 152][i], last_submitted_at: 1000 + i })),
      ...["UCL", "UEL", "UECL"].map((c) => raw({ user_id: 7, tournament_code: c, total_points: 188, max_possible_points: 188, last_submitted_at: 2000 })),
    ];
    const out = aggregateSeasonOverallLeaderboard(rows);
    expect(out[0].top5_points).toBe(690);
    expect(out[0].top5_max_points).toBe(793);
    expect(out[0].eurocups_points).toBe(564);
    expect(out[0].eurocups_max_points).toBe(564);
    expect(out[0].total_points).toBe(1254);
    expect(out[0].max_possible_points).toBe(1357);
    expect(out[0].scored_total_count).toBe(8);
    expect(out[0].last_submitted_at).toBe(2000);
  });

  it("partial coverage 2/5 + 1/3 = 3/8", () => {
    const out = aggregateSeasonOverallLeaderboard([
      raw({ user_id: 1, tournament_code: "PL", total_points: 50, max_possible_points: 163 }),
      raw({ user_id: 1, tournament_code: "SA", total_points: 60, max_possible_points: 163 }),
      raw({ user_id: 1, tournament_code: "UEL", total_points: 100, max_possible_points: 188 }),
    ]);
    expect(out[0].top5_scored_count).toBe(2);
    expect(out[0].eurocups_scored_count).toBe(1);
    expect(out[0].scored_total_count).toBe(3);
    expect(out[0].total_points).toBe(210);
  });

  it("duplicate tournament code does not inflate scored_count", () => {
    const out = aggregateSeasonOverallLeaderboard([
      raw({ user_id: 1, tournament_code: "PL", total_points: 50, max_possible_points: 163 }),
      raw({ user_id: 1, tournament_code: "PL", total_points: 5, max_possible_points: 10 }),
    ]);
    expect(out[0].top5_scored_count).toBe(1);
  });

  it("ignores unrelated tournaments", () => {
    const out = aggregateSeasonOverallLeaderboard([
      raw({ user_id: 1, tournament_code: "WEEKLY", total_points: 999, max_possible_points: 999 }),
      raw({ user_id: 1, tournament_code: "PL", total_points: 50, max_possible_points: 163 }),
    ]);
    expect(out[0].total_points).toBe(50);
    expect(out[0].scored_total_count).toBe(1);
  });
});

describe("compareSeasonOverall", () => {
  it("sorts by total_points DESC, then scored_total_count, then block points", () => {
    const rows = [
      srow({ user_id: 1, total_points: 100, scored_total_count: 5, top5_points: 60, eurocups_points: 40 }),
      srow({ user_id: 2, total_points: 100, scored_total_count: 8, top5_points: 50, eurocups_points: 50 }),
      srow({ user_id: 3, total_points: 120, scored_total_count: 2 }),
    ];
    // 3 leads on points; 2 beats 1 on coverage.
    expect(order(rows)).toEqual([3, 2, 1]);
  });
  it("ties broken by top5_points then eurocups_points", () => {
    const a = srow({ user_id: 1, total_points: 100, scored_total_count: 4, top5_points: 70, eurocups_points: 30 });
    const b = srow({ user_id: 2, total_points: 100, scored_total_count: 4, top5_points: 40, eurocups_points: 60 });
    expect(order([a, b])).toEqual([1, 2]);
  });
  it("missing last_submitted_at sorts last", () => {
    const rows = [
      srow({ user_id: 9, total_points: 50, scored_total_count: 1, last_submitted_at: 1000 }),
      srow({ user_id: 2, total_points: 50, scored_total_count: 1, last_submitted_at: 1000 }),
      srow({ user_id: 5, total_points: 50, scored_total_count: 1, last_submitted_at: null }),
    ];
    expect(order(rows)).toEqual([2, 9, 5]);
  });
});

describe("deriveSeasonOverallEmptyReason", () => {
  it("SCORE_RECALC_REQUIRED only when empty", () => {
    expect(deriveSeasonOverallEmptyReason(false)).toBe("SCORE_RECALC_REQUIRED");
    expect(deriveSeasonOverallEmptyReason(true)).toBeNull();
  });
});
