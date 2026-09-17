// Stage 3 — proves the C-1 fix (migration 0094): reward_ledger.reward_type now
// accepts 'lucky_token', so task rewards configured with Жетоны are actually granted.
//
// Unlike weeklyChallengeTaskClaims.inttest.ts (which builds reward_ledger WITHOUT any
// CHECK and therefore could never observe C-1), this suite builds the *final* reward_ledger
// schema — INCLUDING the post-0094 reward_type CHECK that contains 'lucky_token' — plus the
// fortune_spins / lucky_token_transactions tables the token grant path writes to.
//
// It exercises the REAL exported claim code (claimWeeklyChallengeTaskReward) for the Weekly
// path, and a faithful in-test replica of grantReward's SQL (which is not exported
// from index.ts) for the Season path. A guard test reproduces the original bug against the
// pre-0094 CHECK to prove the fix is load-bearing.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { claimWeeklyChallengeTaskReward } from "../weeklyChallengeTaskClaims";
import { LUCKY_TOKEN_OPS } from "../luckyToken";
import type { WeeklyTaskReward } from "../seasonPredictionWeeklyTasks";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-lucky-token-rl");
const USER_ID = 7001;
const SEASON_ID = 1;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;

// Final reward_ledger schema AFTER migration 0094 (reward_type CHECK includes 'lucky_token').
const REWARD_LEDGER_FINAL = `CREATE TABLE reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task','season_prediction_task')),
  source_id TEXT, unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case','lucky_token')),
  amount INTEGER NOT NULL DEFAULT 0, case_type TEXT,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), granted_by INTEGER, revoked_at INTEGER, revoked_by INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}')`;

async function run(sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}
async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER NOT NULL, season_number INTEGER NOT NULL, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, PRIMARY KEY(user_id, season_number))`,
    `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS balls_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, balls INTEGER, source TEXT, created_at INTEGER, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`,
    REWARD_LEDGER_FINAL,
    `CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC)`,
    // Lucky-token balance (source of truth) + history ledger (migrations 0086/0093).
    `CREATE TABLE IF NOT EXISTS fortune_spins (user_id INTEGER NOT NULL PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS lucky_token_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, ref_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
    // Weekly claim concurrency guard (migration 0090 shape).
    `CREATE TABLE IF NOT EXISTS weekly_challenge_task_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, weekly_challenge_id INTEGER NOT NULL, user_id INTEGER NOT NULL, task_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')), lock_token TEXT, reward_snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), completed_at INTEGER, UNIQUE(weekly_challenge_id, user_id, task_key))`,
  ];
  for (const s of stmts) await db.prepare(s).run();
}

async function resetData() {
  for (const t of ["users", "user_season_progress", "stars_ledger", "balls_ledger", "user_cases", "reward_ledger", "fortune_spins", "lucky_token_transactions", "weekly_challenge_task_claims"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await run(`INSERT INTO users (id, balls) VALUES (?, 0)`, USER_ID);
}

async function tokenBalance() {
  return num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id = ?`, USER_ID);
}

// Faithful replica of grantReward()'s SQL for the lucky_token branch (index.ts:9090-9111).
// grantReward is not exported from index.ts, so we reproduce its exact statements:
//   INSERT OR IGNORE reward_ledger (idempotency guard) -> only on insert, credit tokens + history.
async function grantSeasonLuckyTokenReplica(uniqueKey: string, amount: number, now: number) {
  const ins = await run(
    `INSERT OR IGNORE INTO reward_ledger (user_id, source_type, source_id, unique_key, reward_type, amount, case_type, status, granted_at, granted_by, metadata_json)
     VALUES (?, 'season_prediction_task', ?, ?, 'lucky_token', ?, NULL, 'granted', ?, NULL, '{}')`,
    USER_ID, "season_task", uniqueKey, amount, now,
  );
  if ((ins.meta.changes ?? 0) === 0) return false; // duplicate OR (pre-fix) silently-ignored CHECK violation
  const before = await tokenBalance();
  await run(
    `INSERT OR IGNORE INTO lucky_token_transactions (user_id, amount, balance_before, balance_after, operation_type, comment, admin_user_id, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    USER_ID, amount, before, before + amount, LUCKY_TOKEN_OPS.taskReward, "Награда задания", uniqueKey, now,
  );
  await run(
    `INSERT INTO fortune_spins (user_id, quantity) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
    USER_ID, amount,
  );
  return true;
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  await createSchema();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(resetData);

describe("C-1 fix: reward_ledger accepts lucky_token (migration 0094)", () => {
  it("pre-0094 CHECK rejects lucky_token; post-0094 CHECK accepts it (fix is load-bearing)", async () => {
    // Build a throwaway table with the OLD CHECK to demonstrate the original failure.
    await run(`CREATE TABLE rl_old (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_key TEXT UNIQUE, reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case')))`);
    await expect(
      run(`INSERT INTO rl_old (unique_key, reward_type) VALUES ('x','lucky_token')`),
    ).rejects.toThrow(/CHECK constraint failed/);
    // The final (post-0094) reward_ledger accepts it.
    await run(`INSERT INTO reward_ledger (user_id, source_type, source_id, unique_key, reward_type, amount, status, granted_at) VALUES (?, 'manual_admin', 's', 'ok:lt', 'lucky_token', 1, 'granted', 1)`, USER_ID);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE reward_type='lucky_token'`)).toBe(1);
    await run(`DROP TABLE rl_old`);
  });
});

describe("Season Predictions task — lucky_token claim (grantReward replica)", () => {
  it("grants exactly one token, one ledger row, one history row; replay is a no-op", async () => {
    const uniqueKey = `season_prediction_task_claim:${SEASON_ID}:${USER_ID}:sp_task:lucky_token`;
    const granted = await grantSeasonLuckyTokenReplica(uniqueKey, 1, 1000);
    expect(granted).toBe(true);
    expect(await tokenBalance()).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE reward_type='lucky_token' AND unique_key=?`, uniqueKey)).toBe(1);
    expect(await num(`SELECT amount n FROM reward_ledger WHERE unique_key=?`, uniqueKey)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, uniqueKey)).toBe(1);

    // Replay: idempotent (reward_ledger unique_key already present).
    const second = await grantSeasonLuckyTokenReplica(uniqueKey, 1, 1001);
    expect(second).toBe(false);
    expect(await tokenBalance()).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=?`, uniqueKey)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, uniqueKey)).toBe(1);
  });
});

describe("Weekly Challenge task — lucky_token claim (real claimWeeklyChallengeTaskReward)", () => {
  const TASK_KEY = "weekly_lucky_only";
  const base = `weekly_challenge_task:501:${TASK_KEY}:${USER_ID}`;
  const reward: WeeklyTaskReward = { stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 1 };

  const claim = (token: string, now = 1_800_000_000) =>
    claimWeeklyChallengeTaskReward({
      db, userId: USER_ID, seasonId: SEASON_ID, taskKey: TASK_KEY, base, reward,
      challengeId: 501, nowSeconds: now, nowMs: now * 1000, lockToken: token,
    });

  it("succeeds end-to-end (no WEEKLY_TASK_CLAIM_INCOMPLETE), credits 1 token once, replay no-op", async () => {
    const result = await claim("lt-a");
    expect(result.lucky_tokens).toBe(1);
    expect(await tokenBalance()).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE reward_type='lucky_token' AND unique_key=?`, `${base}:lucky_token`)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, `${base}:lucky_token`)).toBe(1);
    const row = (await db.prepare(`SELECT status, lock_token FROM weekly_challenge_task_claims WHERE weekly_challenge_id=501 AND user_id=? AND task_key=?`).bind(USER_ID, TASK_KEY).first()) as any;
    expect(row.status).toBe("completed");
    expect(row.lock_token).toBeNull();

    await claim("lt-b", 1_800_000_050);
    expect(await tokenBalance()).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key=?`, `${base}:lucky_token`)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, `${base}:lucky_token`)).toBe(1);
  });

  it("mixed reward (stars+balls+case+lucky_token) grants every component exactly once", async () => {
    const mixedKey = "weekly_mixed";
    const mixedBase = `weekly_challenge_task:502:${mixedKey}:${USER_ID}`;
    const mixed: WeeklyTaskReward = { stars: 2, balls: 3, case_type: "basic", case_count: 1, lucky_tokens: 4 };
    const grant = (token: string, now = 1_800_000_100) =>
      claimWeeklyChallengeTaskReward({ db, userId: USER_ID, seasonId: SEASON_ID, taskKey: mixedKey, base: mixedBase, reward: mixed, challengeId: 502, nowSeconds: now, nowMs: now * 1000, lockToken: token });

    await grant("mix-a");
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(3);
    expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type='basic'`, USER_ID)).toBe(1);
    expect(await tokenBalance()).toBe(4);
    // Four reward_ledger rows (stars/balls/case/lucky_token), each once.
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${mixedBase}:%`)).toBe(4);

    await grant("mix-b", 1_800_000_150);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(3);
    expect(await tokenBalance()).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key LIKE ?`, `${mixedBase}:%`)).toBe(4);
  });
});
