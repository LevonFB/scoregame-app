// Stage 10 — unit tests for league-leaderboard SQL V2 pure helpers.

import { describe, expect, it } from "vitest";
import {
  compareLeagueRankings,
  decideLeagueSqlPath,
  leagueRankComparator,
  parseLeagueSqlCallsites,
  sortLeagueRanking,
  type LeagueRankRow,
} from "../leagueLeaderboardSql";
import { resolveApiFlags } from "../featureFlags";

const row = (user_id: number, points: number, exact = 0, joker = 0, earliest = 0): LeagueRankRow =>
  ({ user_id, points, exact_count: exact, joker_points: joker, earliest_pick_time: earliest });

describe("Stage 10 — flag defaults", () => {
  it("defaults to legacy", () => {
    const f = resolveApiFlags({});
    expect(f.leagueLeaderboardSqlV2).toBe(false);
    expect(f.leagueLeaderboardSqlShadow).toBe(false);
  });
  it("garbage cannot enable V2", () => {
    expect(resolveApiFlags({ LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "x" }).leagueLeaderboardSqlV2).toBe(false);
    expect(resolveApiFlags({ LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true" }).leagueLeaderboardSqlV2).toBe(true);
  });
});

describe("Stage 10 — leagueRankComparator / sort", () => {
  it("orders points DESC then tie-breaks; 0 earliest sorts last", () => {
    const sorted = sortLeagueRanking([
      row(1, 10, 1, 0, 0),       // earliest 0 → last among equal points
      row(2, 10, 1, 0, 500),     // earlier pick → ahead
      row(3, 20),                // higher points → first
    ]).map((r) => r.user_id);
    expect(sorted).toEqual([3, 2, 1]);
  });
  it("full tie falls back to user_id ASC", () => {
    const sorted = sortLeagueRanking([row(5, 7, 1, 1, 100), row(2, 7, 1, 1, 100)]).map((r) => r.user_id);
    expect(sorted).toEqual([2, 5]);
  });
  it("comparator is deterministic for exact/joker tie-breaks", () => {
    expect(leagueRankComparator(row(1, 5, 2, 0, 0), row(2, 5, 1, 9, 0))).toBeLessThan(0); // more exact wins
    expect(leagueRankComparator(row(1, 5, 1, 1, 0), row(2, 5, 1, 9, 0))).toBeGreaterThan(0); // more joker wins
  });
});

describe("Stage 10 — compareLeagueRankings", () => {
  const base = [row(3, 20), row(2, 10, 1, 0, 500), row(1, 10, 1, 0, 0)];
  it("identical → match", () => {
    expect(compareLeagueRankings(base, [...base]).match).toBe(true);
  });
  it("row count mismatch", () => {
    const r = compareLeagueRankings(base, base.slice(0, 2));
    expect(r.match).toBe(false); expect(r.reason).toBe("row_count");
  });
  it("id set mismatch", () => {
    const r = compareLeagueRankings(base, [row(3, 20), row(2, 10, 1, 0, 500), row(99, 10, 1, 0, 0)]);
    expect(r.match).toBe(false); expect(r.reason).toBe("id_set");
  });
  it("order mismatch", () => {
    const r = compareLeagueRankings(base, [row(2, 10, 1, 0, 500), row(3, 20), row(1, 10, 1, 0, 0)]);
    expect(r.match).toBe(false); expect(r.reason).toBe("order");
  });
  it("points mismatch", () => {
    const r = compareLeagueRankings(base, [row(3, 21), row(2, 10, 1, 0, 500), row(1, 10, 1, 0, 0)]);
    expect(r.match).toBe(false); expect(r.reason).toBe("points");
  });
  it("tiebreak mismatch (exact/joker/earliest)", () => {
    const r = compareLeagueRankings(base, [row(3, 20), row(2, 10, 2, 0, 500), row(1, 10, 1, 0, 0)]);
    expect(r.match).toBe(false); expect(r.reason).toBe("tiebreak");
  });
  it("empty vs empty → match", () => {
    expect(compareLeagueRankings([], []).match).toBe(true);
  });
});

describe("Stage 11 — parseLeagueSqlCallsites", () => {
  it("default empty → nothing", () => {
    expect(parseLeagueSqlCallsites(undefined).size).toBe(0);
    expect(parseLeagueSqlCallsites("").size).toBe(0);
  });
  it("keeps only KNOWN callsites; ignores unknown/garbage", () => {
    const s = parseLeagueSqlCallsites("achievement, foo, ADMIN, league_api, 123");
    expect([...s].sort()).toEqual(["achievement", "admin", "league_api"]);
  });
});

describe("Stage 11 — decideLeagueSqlPath (callsite model)", () => {
  const I = (o: Partial<Parameters<typeof decideLeagueSqlPath>[0]> = {}) =>
    decideLeagueSqlPath({ v2Enabled: true, shadowEnabled: false, callsiteAllowed: true, periodEligible: true, ...o });
  it("V2 off → legacy", () => expect(I({ v2Enabled: false })).toBe("legacy"));
  it("callsite not allowed → legacy", () => expect(I({ callsiteAllowed: false })).toBe("legacy"));
  it("period not eligible (day/season) → legacy", () => expect(I({ periodEligible: false })).toBe("legacy"));
  it("shadow on → shadow", () => expect(I({ shadowEnabled: true })).toBe("shadow"));
  it("callsite allowed + eligible + no shadow → v2_apply", () => expect(I({})).toBe("v2_apply"));
  it("shadow takes precedence", () => expect(I({ shadowEnabled: true, callsiteAllowed: true })).toBe("shadow"));
});
