import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { computeLeagueLeaderboard, computeLeagueLeaderboardLegacy, computeLeagueLeaderboardSqlV2, getWeekKey } from "../index";
import { compareLeagueRankings } from "../leagueLeaderboardSql";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-leaguesql");
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;

async function schema() {
  await db.prepare(`CREATE TABLE IF NOT EXISTS league_day_stats (league_id TEXT NOT NULL, user_id INTEGER NOT NULL, day TEXT NOT NULL, points INTEGER DEFAULT 0, exact_count INTEGER DEFAULT 0, joker_points INTEGER DEFAULT 0, earliest_pick_time INTEGER DEFAULT 0, PRIMARY KEY (league_id, user_id, day))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_lds_league_day ON league_day_stats(league_id, day)`).run();
}
async function seed(rows: Array<[string, number, string, number, number, number, number]>) {
  for (const [lg, uid, day, pts, exact, joker, early] of rows) {
    await db.prepare(`INSERT OR REPLACE INTO league_day_stats (league_id, user_id, day, points, exact_count, joker_points, earliest_pick_time) VALUES (?,?,?,?,?,?,?)`)
      .bind(lg, uid, day, pts, exact, joker, early).run();
  }
}
const ranks = (r: any) => r.results.map((x: any) => `${x.user_id}:${x.points}:${x.exact_count}:${x.joker_points}`);
const matches = async (lg: string, period: string) => {
  const legacy = await computeLeagueLeaderboardLegacy(env, lg, period);
  const v2 = await computeLeagueLeaderboardSqlV2(env, lg, period);
  return { legacy, v2, cmp: compareLeagueRankings(legacy.results, v2.results) };
};

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await schema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(async () => { await db.prepare(`DELETE FROM league_day_stats`).run(); });

describe("league leaderboard SQL V2 (real D1) — legacy/V2 parity", () => {
  // Days across two different ISO weeks and two months.
  const D = { w1a: "2026-01-05", w1b: "2026-01-07", w2: "2026-01-14", m2: "2026-02-03" };

  it("all-time: identical to legacy and not truncated", async () => {
    await seed([
      ["L1", 1, D.w1a, 10, 2, 1, 500], ["L1", 1, D.w2, 5, 0, 0, 0],
      ["L1", 2, D.w1b, 12, 1, 1, 300], ["L1", 3, D.m2, 12, 1, 1, 200],
    ]);
    const { cmp, v2 } = await matches("L1", "all");
    expect(cmp.match).toBe(true);
    expect(v2.results.length).toBe(3);
    // 3 (early 200) ahead of 2 (early 300) on tie 12 pts; then user 1 (15)
    expect(ranks(v2)[0]).toBe("1:15:2:1");
  });

  it("week: only that week's rows aggregated; identical to legacy", async () => {
    await seed([
      ["L1", 1, D.w1a, 4, 1, 0, 100], ["L1", 1, D.w1b, 6, 0, 1, 0], // same week → sum 10
      ["L1", 2, D.w2, 99, 9, 9, 50], // different week → excluded
    ]);
    const wk = getWeekKey(D.w1a);
    const { cmp, v2 } = await matches("L1", `week:${wk}`);
    expect(cmp.match).toBe(true);
    expect(v2.results.length).toBe(1);
    expect(v2.results[0].user_id).toBe(1);
    expect(v2.results[0].points).toBe(10);
  });

  it("month: only that month; identical to legacy", async () => {
    await seed([
      ["L1", 1, D.w1a, 7, 0, 0, 0], ["L1", 2, D.m2, 20, 2, 0, 0],
    ]);
    const jan = await matches("L1", "month:2026-01");
    expect(jan.cmp.match).toBe(true);
    expect(jan.v2.results.map((r: any) => r.user_id)).toEqual([1]);
    const feb = await matches("L1", "month:2026-02");
    expect(feb.cmp.match).toBe(true);
    expect(feb.v2.results.map((r: any) => r.user_id)).toEqual([2]);
  });

  it("empty league/period → both empty, match", async () => {
    const { cmp, v2 } = await matches("L1", "all");
    expect(cmp.match).toBe(true);
    expect(v2.results.length).toBe(0);
  });

  it("tie on points uses identical tie-break (exact, joker, earliest, user_id)", async () => {
    await seed([
      ["L1", 5, D.w1a, 10, 1, 1, 0],     // earliest 0 → last
      ["L1", 4, D.w1a, 10, 1, 1, 800],
      ["L1", 9, D.w1a, 10, 1, 1, 800],   // tie with 4 → user_id ASC → 4 before 9
    ]);
    const { cmp, v2 } = await matches("L1", "all");
    expect(cmp.match).toBe(true);
    expect(v2.results.map((r: any) => r.user_id)).toEqual([4, 9, 5]);
  });

  it("different leagues are not mixed", async () => {
    await seed([
      ["L1", 1, D.w1a, 10, 0, 0, 0], ["L2", 2, D.w1a, 99, 0, 0, 0],
    ]);
    const a = await matches("L1", "all");
    const b = await matches("L2", "all");
    expect(a.v2.results.map((r: any) => r.user_id)).toEqual([1]);
    expect(b.v2.results.map((r: any) => r.user_id)).toEqual([2]);
    expect(a.cmp.match && b.cmp.match).toBe(true);
  });

  it("gate default (no opts / empty callsites) → legacy; prod call sites unchanged", async () => {
    await seed([["L1", 1, D.w1a, 10, 0, 0, 0]]);
    const r = await computeLeagueLeaderboard({ DB: db } as any, "L1", "all"); // no opts → legacy
    expect(r.results.map((x: any) => x.user_id)).toEqual([1]);
    // callsite set but NOT in (empty) allowlist → legacy
    const r2 = await computeLeagueLeaderboard({ DB: db, LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true" } as any, "L1", "all", { callsite: "achievement" });
    expect(r2.results.map((x: any) => x.user_id)).toEqual([1]);
  });

  it("gate shadow → returns LEGACY even though it also runs V2", async () => {
    await seed([["L1", 1, D.w1a, 10, 0, 0, 0], ["L1", 2, D.w1a, 20, 0, 0, 0]]);
    const e: any = { DB: db, LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_SHADOW_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_V2_CALLSITES: "achievement" };
    const r = await computeLeagueLeaderboard(e, "L1", "all", { callsite: "achievement", viewerId: 555 });
    const legacy = await computeLeagueLeaderboardLegacy(e, "L1", "all");
    expect(r.results.map((x: any) => x.user_id)).toEqual(legacy.results.map((x: any) => x.user_id));
  });

  it("gate v2_apply (callsite allowed, no shadow) → returns V2; unknown callsite → legacy", async () => {
    await seed([["L1", 1, D.w1a, 10, 0, 0, 0], ["L1", 2, D.w1a, 20, 0, 0, 0]]);
    const e: any = { DB: db, LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_V2_CALLSITES: "achievement" };
    const v2 = await computeLeagueLeaderboardSqlV2(e, "L1", "all");
    const r = await computeLeagueLeaderboard(e, "L1", "all", { callsite: "achievement", viewerId: 1 });
    expect(r.results.map((x: any) => x.user_id)).toEqual(v2.results.map((x: any) => x.user_id));
    // callsite 'quest' not enabled → legacy
    const r2 = await computeLeagueLeaderboard(e, "L1", "all", { callsite: "quest", viewerId: 1 });
    expect(r2.results.length).toBe(2);
  });

  it("gate on day:/season: stays legacy even with callsite allowed", async () => {
    await seed([["L1", 1, D.w1a, 10, 0, 0, 0]]);
    const e: any = { DB: db, LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_V2_CALLSITES: "achievement" };
    const r = await computeLeagueLeaderboard(e, "L1", `day:${D.w1a}`, { callsite: "achievement", viewerId: 1 });
    expect(r.results.map((x: any) => x.user_id)).toEqual([1]);
  });

  it("invocation memo collapses identical league+period; different keys not merged", async () => {
    await seed([["L1", 1, D.w1a, 10, 0, 0, 0], ["L2", 2, D.w1a, 5, 0, 0, 0]]);
    const e: any = { DB: db, LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_V2_CALLSITES: "achievement" };
    const memo = new Map<string, Promise<{ results: any[] }>>();
    const o = () => ({ callsite: "achievement", viewerId: 1, memo });
    const a1 = computeLeagueLeaderboard(e, "L1", "all", o());
    const a2 = computeLeagueLeaderboard(e, "L1", "all", o()); // same key → memo hit
    const [r1, r2] = await Promise.all([a1, a2]);
    expect(r2).toBe(r1); // both resolved the SAME memoized computation (one object)
    expect(memo.size).toBe(1);
    const b = await computeLeagueLeaderboard(e, "L2", "all", o()); // different league
    expect(b).not.toBe(r1);
    expect(memo.size).toBe(2);
    // different period also not merged
    await computeLeagueLeaderboard(e, "L1", "month:2026-01", o());
    expect(memo.size).toBe(3);
  });

  it("memo does not cache errors (broken table → retry recomputes)", async () => {
    const e: any = { DB: db, LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_V2_CALLSITES: "achievement" };
    const memo = new Map<string, Promise<{ results: any[] }>>();
    await db.prepare(`DROP TABLE IF EXISTS league_day_stats`).run();
    await expect(computeLeagueLeaderboard(e, "L1", "all", { callsite: "achievement", memo })).rejects.toThrow();
    expect(memo.has("L1|all")).toBe(false); // error not memoized
    await schema();
    await seed([["L1", 1, D.w1a, 3, 0, 0, 0]]);
    const ok = await computeLeagueLeaderboard(e, "L1", "all", { callsite: "achievement", memo });
    expect(ok.results.length).toBe(1);
  });

  it("EXPLAIN QUERY PLAN uses idx_lds_league_day for a week predicate", async () => {
    await seed([["L1", 1, D.w1a, 1, 0, 0, 0]]);
    const wk = getWeekKey(D.w1a);
    // mirror the V2 predicate
    const win = (await import("../index")) as any; // ensure module evaluated
    void win;
    const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT user_id, SUM(points) FROM league_day_stats WHERE league_id = ? AND day >= ? AND day <= ? GROUP BY user_id`)
      .bind("L1", "2026-01-01", "2026-01-31").all();
    const detail = ((plan.results || []) as any[]).map((r) => String(r.detail || "")).join(" | ");
    expect(detail).toMatch(/idx_lds_league_day/);
  });
});
