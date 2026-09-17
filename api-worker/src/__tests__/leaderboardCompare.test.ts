import { describe, expect, it } from "vitest";
import { compareLeaderboards, type LbEntry } from "../leaderboardCompare";

const rows = (...pairs: [string, number][]): LbEntry[] => pairs.map(([userId, points]) => ({ userId, points }));

describe("compareLeaderboards", () => {
  it("identical projections are not divergent", () => {
    const a = rows(["1", 10], ["2", 8], ["3", 5]);
    const r = compareLeaderboards({ oldRows: a, scopedRows: rows(["1", 10], ["2", 8], ["3", 5]), meUserId: "2" });
    expect(r.divergent).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(r.meRankOld).toBe(2);
    expect(r.meRankScoped).toBe(2);
  });

  it("empty state on both sides is not divergent", () => {
    const r = compareLeaderboards({ oldRows: [], scopedRows: [], meUserId: "7" });
    expect(r.divergent).toBe(false);
    expect(r.oldCount).toBe(0);
    expect(r.scopedCount).toBe(0);
    expect(r.meRankOld).toBe(null);
  });

  it("different counts flag 'count' and 'participants'", () => {
    const r = compareLeaderboards({
      oldRows: rows(["1", 10], ["2", 8]),
      scopedRows: rows(["1", 10]),
      meUserId: "1",
    });
    expect(r.divergent).toBe(true);
    expect(r.reasons).toContain("count");
    expect(r.reasons).toContain("participants");
  });

  it("different points flag 'points'", () => {
    const r = compareLeaderboards({
      oldRows: rows(["1", 10], ["2", 8]),
      scopedRows: rows(["1", 10], ["2", 7]),
      meUserId: "1",
    });
    expect(r.divergent).toBe(true);
    expect(r.reasons).toContain("points");
    expect(r.pointMismatchCount).toBe(1);
  });

  it("different ordering flags 'top_order' and 'me_rank'", () => {
    const r = compareLeaderboards({
      oldRows: rows(["1", 10], ["2", 8]),
      scopedRows: rows(["2", 8], ["1", 10]),
      meUserId: "1",
    });
    expect(r.divergent).toBe(true);
    expect(r.reasons).toContain("top_order");
    expect(r.reasons).toContain("me_rank");
    expect(r.meRankOld).toBe(1);
    expect(r.meRankScoped).toBe(2);
  });

  it("different participant set flags 'participants'", () => {
    const r = compareLeaderboards({
      oldRows: rows(["1", 10], ["2", 8]),
      scopedRows: rows(["1", 10], ["3", 8]),
      meUserId: "1",
    });
    expect(r.divergent).toBe(true);
    expect(r.reasons).toContain("participants");
    expect(r.participantsMatch).toBe(false);
  });

  it("me present in old but missing in scoped flags 'me_rank' only (not points)", () => {
    const r = compareLeaderboards({
      oldRows: rows(["9", 3], ["1", 10]),
      scopedRows: rows(["1", 10]),
      meUserId: "9",
    });
    expect(r.meRankOld).toBe(1);
    expect(r.meRankScoped).toBe(null);
    expect(r.reasons).toContain("me_rank");
    // user 9 not in scoped => not counted as a points mismatch
    expect(r.pointMismatchCount).toBe(0);
  });

  it("respects a custom topN for ordering comparison", () => {
    // First 2 identical, divergence only at position 3 => topN=2 sees no order diff
    const old = rows(["1", 10], ["2", 8], ["3", 5]);
    const scoped = rows(["1", 10], ["2", 8], ["4", 5]);
    const r2 = compareLeaderboards({ oldRows: old, scopedRows: scoped, meUserId: "1", topN: 2 });
    expect(r2.reasons).not.toContain("top_order");
    // but participants still differ (3 vs 4)
    expect(r2.reasons).toContain("participants");
  });
});
