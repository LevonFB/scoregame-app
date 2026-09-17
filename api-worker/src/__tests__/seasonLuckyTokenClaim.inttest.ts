// Stage 3.1 — REAL Season Predictions claim integration test for the C-1 fix (migration 0094).
//
// Calls the actual exported production function grantSeasonTaskReward() (the same function the
// season-task claim endpoint invokes at index.ts ~19187) against the FINAL post-0094
// reward_ledger schema (reward_type CHECK includes 'lucky_token'). No SQL is re-implemented here.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { grantSeasonTaskReward } from "../index";
import { taskClaimUniqueKeyBase, type TaskRewardPayload } from "../seasonPredictionTaskRewards";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-season-lt");
const USER_ID = 8101;
const SEASON_ID = 1;
const REAL_CASE_TYPE = "premium"; // real shop_cases code (NOT the weekly-only 'basic')

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

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
const createUserCases = () =>
  db.prepare(`CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`).run();

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, activated_at TEXT, finalized_at TEXT, archived_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1, notes TEXT, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER, season_number INTEGER, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, gold_avatar_frame INTEGER DEFAULT 0, PRIMARY KEY (user_id, season_number))`,
    `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS balls_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, balls INTEGER, source TEXT, created_at INTEGER, UNIQUE(user_id, season_id, task_key, instance_key))`,
    REWARD_LEDGER_FINAL,
    `CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC)`,
    `CREATE TABLE IF NOT EXISTS fortune_spins (user_id INTEGER NOT NULL PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS lucky_token_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, ref_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await createUserCases();
  // Active season id=1 → getCurrentSeasonNumber() resolves to 1 deterministically.
  await db.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1)`).run();
}

async function resetData() {
  await createUserCases(); // in case a partial-failure test dropped it
  for (const t of ["users", "user_season_progress", "stars_ledger", "balls_ledger", "user_cases", "reward_ledger", "fortune_spins", "lucky_token_transactions"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare(`INSERT INTO users (id, balls) VALUES (?, 0)`).bind(USER_ID).run();
}

const tokenBalance = () => num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id=?`, USER_ID);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await createSchema();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(resetData);

describe("REAL Season Predictions claim — lucky_token (grantSeasonTaskReward)", () => {
  const taskKey = "sp_lucky_only";
  const base = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, taskKey);
  const ltKey = `${base}:lucky_token`;

  it("grants exactly one lucky_token via the real claim path; replay is a no-op", async () => {
    const reward: TaskRewardPayload = { stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 1 };
    await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, taskKey, reward);

    expect(await tokenBalance()).toBe(1);
    const row = (await db.prepare(`SELECT source_type, source_id, reward_type, amount, unique_key FROM reward_ledger WHERE unique_key=?`).bind(ltKey).first()) as any;
    expect(row).toMatchObject({ source_type: "season_prediction_task", source_id: taskKey, reward_type: "lucky_token", amount: 1, unique_key: ltKey });
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE user_id=?`, USER_ID)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, ltKey)).toBe(1);
    // No other resources touched.
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(0);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(0);

    // Replay the exact same grant.
    await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, taskKey, reward);
    expect(await tokenBalance()).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=?`, ltKey)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, ltKey)).toBe(1);
  });

  it("mixed reward (stars+balls+case[premium]+lucky_token) grants each component exactly once", async () => {
    const mixedKey = "sp_mixed";
    const mbase = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, mixedKey);
    const reward: TaskRewardPayload = { stars: 2, balls: 3, case_type: REAL_CASE_TYPE, case_count: 1, lucky_tokens: 4 };
    await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, mixedKey, reward);

    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(3);
    expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, REAL_CASE_TYPE)).toBe(1);
    expect(await tokenBalance()).toBe(4);
    // Distinct unique_keys: stars/balls/case:premium/lucky_token.
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${mbase}:%`)).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=? AND reward_type='lucky_token'`, `${mbase}:lucky_token`)).toBe(1);
    expect(await num(`SELECT amount n FROM reward_ledger WHERE unique_key=?`, `${mbase}:case:${REAL_CASE_TYPE}`)).toBe(1);

    // Replay: no component duplicated.
    await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, mixedKey, reward);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(3);
    expect(await tokenBalance()).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${mbase}:%`)).toBe(4);
  });

  it("R-4 FIXED: a mid-delivery failure rolls back the WHOLE atomic batch (nothing stranded); retry delivers every component exactly once", async () => {
    const pkey = "sp_partial";
    const pbase = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, pkey);
    const reward: TaskRewardPayload = { stars: 2, balls: 3, case_type: REAL_CASE_TYPE, case_count: 1, lucky_tokens: 4 };

    // Inject a failure inside the single atomic batch: drop user_cases so the case statements
    // error → the ENTIRE batch (stars+balls+case+lucky_token) rolls back.
    await db.prepare(`DROP TABLE user_cases`).run();
    let threw = false;
    try {
      await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, pkey, reward);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Truthful ledger: NOTHING persisted — no credits, no reward_ledger rows at all.
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(0);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(0);
    expect(await tokenBalance()).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${pbase}:%`)).toBe(0);

    // Recover: restore the table and re-claim → all four components delivered exactly once.
    await createUserCases();
    await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, pkey, reward);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(3);
    expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, REAL_CASE_TYPE)).toBe(1);
    expect(await tokenBalance()).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${pbase}:%`)).toBe(4);

    // And a further replay stays a no-op.
    await grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, pkey, reward);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await tokenBalance()).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${pbase}:%`)).toBe(4);
  });
});
