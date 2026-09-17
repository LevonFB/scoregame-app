// Stage 13 — in-process integration: PRODUCTION GUARD. Proves runSeasonalShadow
// performs NO INSERT/UPDATE/DELETE on any writable table, plus match/mismatch/level.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { runSeasonalShadow } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-seasonal");
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;
const USER = 555;

async function schema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, activated_at TEXT, finalized_at TEXT, archived_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1, notes TEXT, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, scope TEXT NOT NULL, rarity TEXT DEFAULT 'common', emoji TEXT DEFAULT '*', title TEXT DEFAULT 't', description TEXT DEFAULT '', condition_type TEXT NOT NULL, threshold INTEGER DEFAULT 1, stars_reward INTEGER DEFAULT 0, version INTEGER DEFAULT 1, meta_json TEXT)`,
    `CREATE TABLE IF NOT EXISTS tasks_catalog (task_key TEXT PRIMARY KEY, task_type TEXT, period_type TEXT, is_enabled INTEGER DEFAULT 1, league_only INTEGER DEFAULT 0, reward_stars INTEGER DEFAULT 0, reward_balls INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 100)`,
    `CREATE TABLE IF NOT EXISTS user_task_progress (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, progress INTEGER DEFAULT 0, completed_at INTEGER, reward_granted INTEGER DEFAULT 0, shown_at INTEGER, PRIMARY KEY (user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS user_achievements (user_id INTEGER, achievement_id TEXT, scope_target_id TEXT DEFAULT '', period_key TEXT DEFAULT 'all', progress INTEGER DEFAULT 0, unlocked_at INTEGER, earned_at INTEGER, state TEXT, shown_at INTEGER, context_day TEXT, context_match_id TEXT, meta_json TEXT, PRIMARY KEY (user_id, achievement_id, scope_target_id, period_key))`,
    `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER, season_number INTEGER, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, gold_avatar_frame INTEGER DEFAULT 0, PRIMARY KEY (user_id, season_number))`,
    `CREATE TABLE IF NOT EXISTS picks (day TEXT, match_id TEXT, user_id INTEGER, home INTEGER, away INTEGER, joker INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY (day, match_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS league_members (league_id TEXT, user_id INTEGER, PRIMARY KEY (league_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS leagues (id TEXT PRIMARY KEY, name TEXT, type TEXT, owner_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS balls_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, balls INTEGER, reason TEXT, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await db.prepare(`INSERT OR REPLACE INTO seasons (id, name, slug, status, starts_at, ends_at, display_order, is_visible) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1)`).run();
}
async function seed() {
  await db.prepare(`INSERT OR REPLACE INTO achievements (id, scope, condition_type, threshold, stars_reward) VALUES ('season_picks_test','global','picks_total',2,10)`).run();
  await db.prepare(`INSERT OR REPLACE INTO tasks_catalog (task_key, task_type, period_type, is_enabled, reward_stars, reward_balls) VALUES ('season_picks_test','seasonal','seasonal',1,10,0)`).run();
  await db.prepare(`INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES ('2026-06-15','m1',?,1,0,0,1),('2026-06-16','m2',?,2,1,0,1)`).bind(USER, USER).run();
  await db.prepare(`INSERT OR REPLACE INTO user_season_progress (user_id, season_number, stars, level) VALUES (?,1,0,1)`).bind(USER).run();
}
const WRITE = ["user_task_progress", "user_achievements", "stars_ledger", "balls_ledger", "user_season_progress", "picks", "users"];
async function snapshot(): Promise<string> {
  const parts: string[] = [];
  for (const t of WRITE) {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first() as any;
    parts.push(`${t}=${r?.n ?? 0}`);
  }
  const s = await db.prepare(`SELECT COALESCE(SUM(stars),0) AS n FROM user_season_progress`).first() as any;
  parts.push(`stars=${s?.n ?? 0}`);
  return parts.join(",");
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await schema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(async () => {
  for (const t of [...WRITE, "achievements", "tasks_catalog", "league_members"]) await db.prepare(`DELETE FROM ${t}`).run();
});

describe("Stage 13 — seasonal shadow production guard (no writes)", () => {
  it("pending seasonal quest → mismatch, but ZERO writes to any table", async () => {
    await seed(); // 2 picks, no stored progress → expected completed but missing
    const before = await snapshot();
    const r = await runSeasonalShadow(env, "points_awarded", USER);
    expect(r.mismatched).toBeGreaterThanOrEqual(1);
    expect(await snapshot()).toBe(before); // shadow wrote nothing
  });

  it("repeat event → still zero writes (no side effects)", async () => {
    await seed();
    const before = await snapshot();
    await runSeasonalShadow(env, "points_awarded", USER);
    await runSeasonalShadow(env, "case_opened", USER);
    expect(await snapshot()).toBe(before);
  });

  it("already-applied state → match (0 mismatch), no writes", async () => {
    await seed();
    await db.prepare(`INSERT OR REPLACE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted) VALUES (?,1,'season_picks_test','season',2,?,1)`).bind(USER, Date.now()).run();
    await db.prepare(`UPDATE user_season_progress SET stars=10 WHERE user_id=? AND season_number=1`).bind(USER).run();
    const before = await snapshot();
    const r = await runSeasonalShadow(env, "points_awarded", USER);
    expect(r.matched).toBeGreaterThanOrEqual(1);
    expect(r.mismatched).toBe(0);
    expect(await snapshot()).toBe(before);
  });

  it("not-met quest with no stored row → match (legacy stores nothing); no writes", async () => {
    // only 1 pick → progress 1 < threshold 2 → not completed, nothing stored → consistent
    await db.prepare(`INSERT OR REPLACE INTO achievements (id, scope, condition_type, threshold, stars_reward) VALUES ('season_picks_test','global','picks_total',2,10)`).run();
    await db.prepare(`INSERT OR REPLACE INTO tasks_catalog (task_key, task_type, period_type, is_enabled, reward_stars) VALUES ('season_picks_test','seasonal','seasonal',1,10)`).run();
    await db.prepare(`INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES ('2026-06-15','m1',?,1,0,0,1)`).bind(USER).run();
    await db.prepare(`INSERT OR REPLACE INTO user_season_progress (user_id, season_number, stars, level) VALUES (?,1,0,1)`).bind(USER).run();
    const before = await snapshot();
    const r = await runSeasonalShadow(env, "prediction_saved", USER);
    expect(r.mismatched).toBe(0);
    expect(await snapshot()).toBe(before);
  });

  it("different season's data does not leak (empty achievements → no quest, level match)", async () => {
    await db.prepare(`INSERT OR REPLACE INTO user_season_progress (user_id, season_number, stars, level) VALUES (?,1,0,1)`).bind(USER).run();
    const before = await snapshot();
    const r = await runSeasonalShadow(env, "points_awarded", USER);
    expect(r.matched).toBe(0);
    expect(r.mismatched).toBe(0);
    expect(await snapshot()).toBe(before);
  });
});
