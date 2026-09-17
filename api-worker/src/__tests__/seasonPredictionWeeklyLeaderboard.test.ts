import { describe, expect, it } from "vitest";
import {
  findWeeklyLeaderboardEntry,
  paginateWeeklyLeaderboard,
  rankWeeklyLeaderboard,
  type WeeklyLeaderboardRow,
} from "../seasonPredictionWeeklyLeaderboard";

function row(over: Partial<WeeklyLeaderboardRow> = {}): WeeklyLeaderboardRow {
  return {
    user_id: over.user_id ?? 1,
    display_name: over.display_name ?? `u${over.user_id ?? 1}`,
    avatar_url: over.avatar_url ?? null,
    total_points: over.total_points ?? 0,
    max_points: over.max_points ?? 5,
    points_pct: over.points_pct ?? (over.total_points ?? 0) / 5,
    submitted_at: over.submitted_at ?? null,
    scored_at: over.scored_at ?? null,
  };
}

describe("rankWeeklyLeaderboard", () => {
  it("sorts by points desc and assigns ranks", () => {
    const ranked = rankWeeklyLeaderboard([
      row({ user_id: 1, total_points: 3 }),
      row({ user_id: 2, total_points: 5 }),
      row({ user_id: 3, total_points: 4 }),
    ]);
    expect(ranked.map((r) => [r.user_id, r.rank])).toEqual([[2, 1], [3, 2], [1, 3]]);
  });

  it("uses competition rank for ties (1, 1, 3)", () => {
    const ranked = rankWeeklyLeaderboard([
      row({ user_id: 1, total_points: 5, submitted_at: 200 }),
      row({ user_id: 2, total_points: 5, submitted_at: 100 }),
      row({ user_id: 3, total_points: 3 }),
    ]);
    // tie on points → both rank 1, ordered by submitted_at asc; next distinct → rank 3
    expect(ranked.map((r) => [r.user_id, r.rank])).toEqual([[2, 1], [1, 1], [3, 3]]);
  });

  it("breaks ties stably by submitted_at then user_id", () => {
    const ranked = rankWeeklyLeaderboard([
      row({ user_id: 9, total_points: 4, submitted_at: 100 }),
      row({ user_id: 4, total_points: 4, submitted_at: 100 }),
      row({ user_id: 7, total_points: 4, submitted_at: 50 }),
    ]);
    expect(ranked.map((r) => r.user_id)).toEqual([7, 4, 9]);
    expect(ranked.every((r) => r.rank === 1)).toBe(true);
  });

  it("treats a missing submitted_at as last among equal points", () => {
    const ranked = rankWeeklyLeaderboard([
      row({ user_id: 1, total_points: 4, submitted_at: null }),
      row({ user_id: 2, total_points: 4, submitted_at: 100 }),
    ]);
    expect(ranked.map((r) => r.user_id)).toEqual([2, 1]);
  });

  it("ranks rows with different pct but equal points distinctly", () => {
    const ranked = rankWeeklyLeaderboard([
      row({ user_id: 1, total_points: 4, points_pct: 0.8 }),
      row({ user_id: 2, total_points: 4, points_pct: 1 }),
    ]);
    // higher pct first, and they are NOT tied (pct differs) → ranks 1, 2
    expect(ranked.map((r) => [r.user_id, r.rank])).toEqual([[2, 1], [1, 2]]);
  });
});

describe("paginateWeeklyLeaderboard", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it("slices a page and reports totals", () => {
    const { slice, pagination } = paginateWeeklyLeaderboard(items, 1, 20);
    expect(slice.length).toBe(20);
    expect(pagination).toEqual({ page: 1, limit: 20, total: 25, pages: 2 });
  });

  it("returns the tail on the last page", () => {
    const { slice } = paginateWeeklyLeaderboard(items, 2, 20);
    expect(slice).toEqual([21, 22, 23, 24, 25]);
  });

  it("clamps page to >= 1 and handles empty", () => {
    expect(paginateWeeklyLeaderboard(items, 0, 20).pagination.page).toBe(1);
    expect(paginateWeeklyLeaderboard([], 1, 20).pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
  });
});

describe("findWeeklyLeaderboardEntry", () => {
  it("finds a user's ranked row even if off the current page", () => {
    const ranked = rankWeeklyLeaderboard(Array.from({ length: 30 }, (_, i) => row({ user_id: i + 1, total_points: 30 - i })));
    const me = findWeeklyLeaderboardEntry(ranked, 25);
    expect(me?.user_id).toBe(25);
    expect(me?.rank).toBe(25);
  });

  it("returns null for a user with no score", () => {
    const ranked = rankWeeklyLeaderboard([row({ user_id: 1, total_points: 3 })]);
    expect(findWeeklyLeaderboardEntry(ranked, 999)).toBeNull();
  });
});
