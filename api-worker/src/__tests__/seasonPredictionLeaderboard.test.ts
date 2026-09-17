import { describe, it, expect } from "vitest";
import {
  aggregateOverallTopLeaguesLeaderboard,
  clampLeaderboardLimit,
  compareOverall,
  comparePerLeague,
  derivePerLeagueEmptyReason,
  deriveOverallEmptyReason,
  leaderboardPointsPct,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
  normalizeLeaderboardOffset,
  rankAndPaginate,
  type LeaderboardMetricRow,
  type RawLeagueScoreRow,
} from "../seasonPredictionLeaderboard";

function row(partial: Partial<LeaderboardMetricRow> & { user_id: number }): LeaderboardMetricRow {
  return {
    total_points: 0,
    max_possible_points: 0,
    exact_positions: 0,
    errors_le_1: 0,
    errors_le_2: 0,
    champion_correct: 0,
    ucl_zone_correct: 0,
    relegation_zone_correct: 0,
    last_submitted_at: null,
    scored_at: null,
    ...partial,
  };
}

function order(rows: LeaderboardMetricRow[], cmp: (a: LeaderboardMetricRow, b: LeaderboardMetricRow) => number) {
  return [...rows].sort(cmp).map((r) => r.user_id);
}

describe("leaderboardPointsPct", () => {
  it("rounds to 4 decimals and guards divide-by-zero", () => {
    expect(leaderboardPointsPct(145, 163)).toBe(0.8896);
    expect(leaderboardPointsPct(0, 0)).toBe(0);
    expect(leaderboardPointsPct(10, 0)).toBe(0);
  });
});

describe("limit / offset normalization", () => {
  it("defaults and clamps the limit", () => {
    expect(clampLeaderboardLimit(undefined)).toBe(LEADERBOARD_DEFAULT_LIMIT);
    expect(clampLeaderboardLimit("0")).toBe(LEADERBOARD_DEFAULT_LIMIT);
    expect(clampLeaderboardLimit(-5)).toBe(LEADERBOARD_DEFAULT_LIMIT);
    expect(clampLeaderboardLimit(25)).toBe(25);
    expect(clampLeaderboardLimit(500)).toBe(LEADERBOARD_MAX_LIMIT);
  });
  it("normalizes the offset", () => {
    expect(normalizeLeaderboardOffset(undefined)).toBe(0);
    expect(normalizeLeaderboardOffset(-10)).toBe(0);
    expect(normalizeLeaderboardOffset("30")).toBe(30);
  });
});

describe("comparePerLeague", () => {
  it("sorts by total_points DESC first", () => {
    const rows = [row({ user_id: 1, total_points: 100 }), row({ user_id: 2, total_points: 145 })];
    expect(order(rows, comparePerLeague)).toEqual([2, 1]);
  });

  it("breaks ties by champion_correct then exact_positions", () => {
    const rows = [
      row({ user_id: 1, total_points: 100, champion_correct: 0, exact_positions: 10 }),
      row({ user_id: 2, total_points: 100, champion_correct: 0, exact_positions: 16 }),
      row({ user_id: 3, total_points: 100, champion_correct: 1, exact_positions: 1 }),
    ];
    // champion_correct wins first (3), then exact_positions (2 over 1).
    expect(order(rows, comparePerLeague)).toEqual([3, 2, 1]);
  });

  it("breaks a pure exact_positions tie", () => {
    const rows = [
      row({ user_id: 7, total_points: 50, exact_positions: 5 }),
      row({ user_id: 4, total_points: 50, exact_positions: 9 }),
    ];
    expect(order(rows, comparePerLeague)).toEqual([4, 7]);
  });

  it("puts missing last_submitted_at last, earlier submissions ahead", () => {
    const rows = [
      row({ user_id: 1, total_points: 50, last_submitted_at: null }),
      row({ user_id: 2, total_points: 50, last_submitted_at: 2000 }),
      row({ user_id: 3, total_points: 50, last_submitted_at: 1000 }),
    ];
    // earlier submission (3) before later (2) before missing (1)
    expect(order(rows, comparePerLeague)).toEqual([3, 2, 1]);
  });

  it("falls back to user_id ASC as the final tiebreak", () => {
    const rows = [
      row({ user_id: 9, total_points: 50, last_submitted_at: 1000 }),
      row({ user_id: 2, total_points: 50, last_submitted_at: 1000 }),
    ];
    expect(order(rows, comparePerLeague)).toEqual([2, 9]);
  });
});

describe("compareOverall", () => {
  it("sorts by summed total_points then accuracy metrics, coverage after", () => {
    const rows = [
      row({ user_id: 1, total_points: 200, exact_positions: 30, scored_leagues_count: 5 }),
      row({ user_id: 2, total_points: 200, exact_positions: 30, scored_leagues_count: 2 }),
      row({ user_id: 3, total_points: 260, exact_positions: 10, scored_leagues_count: 1 }),
    ];
    // 3 leads on points; 1 beats 2 on coverage when accuracy ties.
    expect(order(rows, compareOverall)).toEqual([3, 1, 2]);
  });

  it("uses errors_le_2 before coverage", () => {
    const rows = [
      row({ user_id: 1, total_points: 100, champion_correct: 0, exact_positions: 5, errors_le_2: 10, scored_leagues_count: 5 }),
      row({ user_id: 2, total_points: 100, champion_correct: 0, exact_positions: 5, errors_le_2: 20, scored_leagues_count: 1 }),
    ];
    expect(order(rows, compareOverall)).toEqual([2, 1]);
  });
});

describe("rankAndPaginate", () => {
  const rows = [
    row({ user_id: 1, total_points: 145, max_possible_points: 163, scored_at: 1000 }),
    row({ user_id: 2, total_points: 120, max_possible_points: 163, scored_at: 1500 }),
    row({ user_id: 3, total_points: 90, max_possible_points: 163, scored_at: 1200 }),
  ];

  it("assigns global ranks and computes my_rank + gap_to_leader", () => {
    const out = rankAndPaginate(rows, comparePerLeague, { limit: 50, offset: 0, currentUserId: 2 });
    expect(out.page.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.page.map((p) => p.row.user_id)).toEqual([1, 2, 3]);
    expect(out.myRank).toEqual({
      rank: 2,
      total_points: 120,
      max_possible_points: 163,
      points_pct: leaderboardPointsPct(120, 163),
      gap_to_leader: 25,
    });
    expect(out.updatedAt).toBe(1500);
    expect(out.total).toBe(3);
  });

  it("paginates with correct absolute ranks and has_more", () => {
    const out = rankAndPaginate(rows, comparePerLeague, { limit: 1, offset: 1, currentUserId: null });
    expect(out.page).toHaveLength(1);
    expect(out.page[0].rank).toBe(2);
    expect(out.page[0].row.user_id).toBe(2);
    expect(out.pagination).toEqual({ limit: 1, offset: 1, has_more: true });
    expect(out.myRank).toBeNull();
  });

  it("returns my_rank null when the user is not scored", () => {
    const out = rankAndPaginate(rows, comparePerLeague, { limit: 50, offset: 0, currentUserId: 999 });
    expect(out.myRank).toBeNull();
  });

  it("handles an empty leaderboard", () => {
    const out = rankAndPaginate([], comparePerLeague, { limit: 50, offset: 0, currentUserId: 1 });
    expect(out.total).toBe(0);
    expect(out.page).toEqual([]);
    expect(out.myRank).toBeNull();
    expect(out.updatedAt).toBeNull();
    expect(out.pagination.has_more).toBe(false);
  });
});

function leagueRow(p: Partial<RawLeagueScoreRow> & { user_id: number; tournament_code: string }): RawLeagueScoreRow {
  return {
    total_points: 0,
    max_possible_points: 0,
    exact_positions: 0,
    errors_le_1: 0,
    errors_le_2: 0,
    champion_correct: 0,
    ucl_zone_correct: 0,
    relegation_zone_correct: 0,
    last_submitted_at: null,
    scored_at: null,
    ...p,
  };
}

describe("aggregateOverallTopLeaguesLeaderboard", () => {
  it("counts partial coverage — one league scored gives scored_leagues_count 1", () => {
    const out = aggregateOverallTopLeaguesLeaderboard([
      leagueRow({ user_id: 7, tournament_code: "PL", total_points: 145, max_possible_points: 163, exact_positions: 16, scored_at: 1000, last_submitted_at: 900 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scored_leagues_count).toBe(1);
    expect(out[0].total_points).toBe(145);
    expect(out[0].max_possible_points).toBe(163);
    expect(out[0].exact_positions).toBe(16);
  });

  it("sums metrics across leagues and counts distinct tournament codes", () => {
    const out = aggregateOverallTopLeaguesLeaderboard([
      leagueRow({ user_id: 7, tournament_code: "PL", total_points: 145, max_possible_points: 163, champion_correct: 1, scored_at: 1000, last_submitted_at: 900 }),
      leagueRow({ user_id: 7, tournament_code: "PD", total_points: 100, max_possible_points: 150, champion_correct: 0, scored_at: 1200, last_submitted_at: 1100 }),
      // duplicate code must not inflate the league count
      leagueRow({ user_id: 7, tournament_code: "PD", total_points: 5, max_possible_points: 10 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scored_leagues_count).toBe(2);
    expect(out[0].total_points).toBe(250);
    expect(out[0].max_possible_points).toBe(323);
    expect(out[0].champion_correct).toBe(1);
    expect(out[0].scored_at).toBe(1200); // latest
    expect(out[0].last_submitted_at).toBe(1100); // latest
  });

  it("groups independent users separately", () => {
    const out = aggregateOverallTopLeaguesLeaderboard([
      leagueRow({ user_id: 1, tournament_code: "PL", total_points: 50 }),
      leagueRow({ user_id: 2, tournament_code: "PL", total_points: 90 }),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((r) => r.user_id))).toEqual(new Set([1, 2]));
  });

  it("returns nothing for no rows", () => {
    expect(aggregateOverallTopLeaguesLeaderboard([])).toEqual([]);
  });
});

describe("empty-state reasons", () => {
  it("per-league requires official results when not confirmed", () => {
    expect(derivePerLeagueEmptyReason({ hasItems: false, officialConfirmed: false })).toBe("OFFICIAL_RESULTS_REQUIRED");
  });
  it("per-league asks for recalc when official confirmed but no scores", () => {
    expect(derivePerLeagueEmptyReason({ hasItems: false, officialConfirmed: true })).toBe("SCORE_RECALC_REQUIRED");
  });
  it("per-league has no reason when items exist", () => {
    expect(derivePerLeagueEmptyReason({ hasItems: true, officialConfirmed: false })).toBeNull();
  });
  it("overall only asks for recalc, never official results", () => {
    expect(deriveOverallEmptyReason({ hasItems: false })).toBe("SCORE_RECALC_REQUIRED");
    expect(deriveOverallEmptyReason({ hasItems: true })).toBeNull();
  });
});
