// R-4 reliability for the shared reward-delivery primitive grantReward across its active
// source_types (manual_admin / weekly_challenge_task / season_prediction_task). Drives the REAL
// exported grantReward (an atomic per-component db.batch) against the final post-0094 schema.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { grantReward } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-reward-r4");
const USER_ID = 9501;
const CASE_TYPE = "daily_free"; // real shop_cases code

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

// Final reward_ledger schema. The CHECK constraint still permits the legacy bracket_* source_types
// for historical rows, but active runtime only produces the three exercised below.
const REWARD_LEDGER_FINAL = `CREATE TABLE reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task','season_prediction_task')),
  source_id TEXT, unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case','lucky_token')),
  amount INTEGER NOT NULL DEFAULT 0, case_type TEXT,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), granted_by INTEGER, revoked_at INTEGER, revoked_by INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}')`;

async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}
const tokenBalance = () => num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id=?`, USER_ID);

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, activated_at TEXT, finalized_at TEXT, archived_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1, notes TEXT, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER, season_number INTEGER, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, gold_avatar_frame INTEGER DEFAULT 0, PRIMARY KEY (user_id, season_number))`,
    `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS balls_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, balls INTEGER, source TEXT, created_at INTEGER, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`,
    REWARD_LEDGER_FINAL,
    `CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC)`,
    `CREATE TABLE IF NOT EXISTS fortune_spins (user_id INTEGER NOT NULL PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS lucky_token_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, ref_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await db.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1)`).run();
}
const createUserCases = () => db.prepare(`CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`).run();
async function resetData() {
  await createUserCases();
  for (const t of ["users", "user_season_progress", "stars_ledger", "balls_ledger", "user_cases", "reward_ledger", "fortune_spins", "lucky_token_transactions"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare(`INSERT INTO users (id, balls) VALUES (?, 0)`).bind(USER_ID).run();
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await createSchema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(resetData);

const SOURCES = ["manual_admin", "weekly_challenge_task", "season_prediction_task"] as const;

describe("grantReward: each source_type × each reward_type — exactly-once + truthful + concurrency", () => {
  for (const src of SOURCES) {
    it(`${src}: stars deliver once; repeat + concurrent no-op; returns newly-granted only first time`, async () => {
      const uk = `${src}:1:${USER_ID}:s:stars`;
      const r1 = await grantReward(env as any, USER_ID, src, "s", uk, "stars", 5, undefined, 42, { src });
      expect(r1).toBe(true);
      expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(5);
      expect(await num(`SELECT COUNT(*) n FROM stars_ledger WHERE instance_key=?`, uk)).toBe(1);
      expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=? AND status='granted' AND granted_by=42`, uk)).toBe(1);
      // repeat → newly-granted false, no double
      const r2 = await grantReward(env as any, USER_ID, src, "s", uk, "stars", 5, undefined, 42, { src });
      expect(r2).toBe(false);
      expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(5);
      // concurrent → exactly once
      await Promise.allSettled([
        grantReward(env as any, USER_ID, src, "s", uk, "stars", 5, undefined, 42, { src }),
        grantReward(env as any, USER_ID, src, "s", uk, "stars", 5, undefined, 42, { src }),
      ]);
      expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(5);
      expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=?`, uk)).toBe(1);
    });

    it(`${src}: balls / case / lucky_token each deliver exactly once and replay no-op`, async () => {
      const ukB = `${src}:1:${USER_ID}:s:balls`;
      const ukC = `${src}:1:${USER_ID}:s:case:${CASE_TYPE}`;
      const ukL = `${src}:1:${USER_ID}:s:lucky_token`;
      await grantReward(env as any, USER_ID, src, "s", ukB, "balls", 7, undefined, null, {});
      await grantReward(env as any, USER_ID, src, "s", ukC, "case", 2, CASE_TYPE, null, {});
      await grantReward(env as any, USER_ID, src, "s", ukL, "lucky_token", 3, undefined, null, {});
      expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(7);
      expect(await num(`SELECT COUNT(*) n FROM balls_ledger WHERE instance_key=?`, ukB)).toBe(1);
      expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, CASE_TYPE)).toBe(2);
      expect(await tokenBalance()).toBe(3);
      expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, ukL)).toBe(1);
      // replay all three
      await grantReward(env as any, USER_ID, src, "s", ukB, "balls", 7, undefined, null, {});
      await grantReward(env as any, USER_ID, src, "s", ukC, "case", 2, CASE_TYPE, null, {});
      await grantReward(env as any, USER_ID, src, "s", ukL, "lucky_token", 3, undefined, null, {});
      expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(7);
      expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, CASE_TYPE)).toBe(2);
      expect(await tokenBalance()).toBe(3);
    });
  }
});

describe("grantReward: fault injection + truthful ledger (case has no separate receipt)", () => {
  it("a failing case credit rolls back atomically — NO false-granted reward_ledger row; retry delivers", async () => {
    const uk = `season_prediction_task:1:${USER_ID}:s:case:${CASE_TYPE}`;
    await db.prepare(`DROP TABLE user_cases`).run();
    let threw = false;
    try { await grantReward(env as any, USER_ID, "season_prediction_task", "s", uk, "case", 1, CASE_TYPE, null, {}); }
    catch { threw = true; }
    expect(threw).toBe(true);
    // No stranded ledger row (the whole component batch rolled back).
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=?`, uk)).toBe(0);
    // Recover and retry → delivered exactly once.
    await createUserCases();
    const ok = await grantReward(env as any, USER_ID, "season_prediction_task", "s", uk, "case", 1, CASE_TYPE, null, {});
    expect(ok).toBe(true);
    expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, CASE_TYPE)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=?`, uk)).toBe(1);
  });
});

describe("grantReward: all-zero / invalid components", () => {
  it("amount <= 0 is a no-op returning false; no rows written; repeat safe", async () => {
    const uk = `manual_admin:1:${USER_ID}:s:stars`;
    expect(await grantReward(env as any, USER_ID, "manual_admin", "s", uk, "stars", 0, undefined, 1, {})).toBe(false);
    expect(await grantReward(env as any, USER_ID, "manual_admin", "s", uk, "balls", -3, undefined, 1, {})).toBe(false);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE user_id=?`, USER_ID)).toBe(0);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(0);
  });

  it("case with missing case_type is a no-op returning false", async () => {
    expect(await grantReward(env as any, USER_ID, "manual_admin", "s", "manual_admin:1:9501:s:case:", "case", 1, undefined, 1, {})).toBe(false);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE user_id=?`, USER_ID)).toBe(0);
  });
});
