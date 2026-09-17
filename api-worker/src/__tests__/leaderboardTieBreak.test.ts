import { describe, expect, it } from "vitest";
import { rankWithSharedPlaces } from "../leaderboardTieBreak";

const row = (userId: number, points: number, exactCount = 0, diffCount = 0, outcomeCount = 0) =>
  ({ userId, points, exactCount, diffCount, outcomeCount });

const ranks = (rows: ReturnType<typeof row>[]) =>
  rankWithSharedPlaces(rows).map((r) => [r.userId, r.rank]);

describe("leaderboard tie-break", () => {
  it("orders by points first", () => {
    expect(ranks([row(1, 5), row(2, 10)])).toEqual([[2, 1], [1, 2]]);
  });

  it("equal points: more exact scores wins", () => {
    expect(ranks([row(1, 10, 0, 2, 2), row(2, 10, 2)])).toEqual([[2, 1], [1, 2]]);
  });

  it("equal exact: more diffs, then more outcomes", () => {
    expect(ranks([row(1, 7, 1, 0, 1), row(2, 8, 1, 1, 0), row(3, 7, 1, 0, 1)])).toEqual([[2, 1], [1, 2], [3, 2]]);
    expect(ranks([row(1, 6, 0, 0, 3), row(2, 6, 0, 2, 0)])).toEqual([[2, 1], [1, 2]]);
  });

  it("full tie shares the place and skips the next one (1, 2, 2, 4)", () => {
    expect(ranks([row(9, 3, 0, 1), row(4, 5, 1), row(7, 3, 0, 1), row(1, 2, 0, 0, 1)])).toEqual([
      [4, 1], [7, 2], [9, 2], [1, 4],
    ]);
  });

  it("ignores user id and registration order for the place", () => {
    expect(ranks([row(100, 5, 1), row(1, 5, 1)]).map(([, rank]) => rank)).toEqual([1, 1]);
  });
});
