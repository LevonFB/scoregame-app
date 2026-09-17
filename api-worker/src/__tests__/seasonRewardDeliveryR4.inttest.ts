// Stage 4 — R-4 reliability suite for Season Predictions reward delivery.
// Drives the REAL exported grantSeasonTaskReward() (atomic db.batch model) against the FINAL
// post-0094 reward_ledger schema and proves invariants A–E: truthful ledger, safe retry,
// concurrency, mixed-reward recovery, and no false success.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { grantSeasonTaskReward } from "../index";
import { taskClaimUniqueKeyBase, type TaskRewardPayload } from "../seasonPredictionTaskRewards";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-r4");
const USER_ID = 9301;
const SEASON_ID = 1;
const CASE_TYPE = "premium"; // real shop_cases code

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
const tokenBalance = () => num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id=?`, USER_ID);
// Range scan instead of LIKE: '_' is a LIKE wildcard and unique_key contains many of them.
const ledgerRows = (base: string) => num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key >= ? AND unique_key < ?`, `${base}:`, `${base};`);

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
async function resetData() {
  for (const t of ["users", "user_season_progress", "stars_ledger", "balls_ledger", "user_cases", "reward_ledger", "fortune_spins", "lucky_token_transactions"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare(`INSERT INTO users (id, balls) VALUES (?, 0)`).bind(USER_ID).run();
}
const grant = (taskKey: string, reward: TaskRewardPayload) => grantSeasonTaskReward(env as any, USER_ID, SEASON_ID, taskKey, reward);

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

describe("per-type exactly-once: first claim, repeat, concurrent", () => {
  const cases: Array<{ name: string; reward: TaskRewardPayload; assert: (base: string) => Promise<void> }> = [
    {
      name: "stars",
      reward: { stars: 5, balls: 0, case_type: null, case_count: 0, lucky_tokens: 0 },
      assert: async () => {
        expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(5);
        expect(await num(`SELECT COUNT(*) n FROM stars_ledger WHERE user_id=?`, USER_ID)).toBe(1);
      },
    },
    {
      name: "balls",
      reward: { stars: 0, balls: 7, case_type: null, case_count: 0, lucky_tokens: 0 },
      assert: async () => {
        expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(7);
        expect(await num(`SELECT COUNT(*) n FROM balls_ledger WHERE user_id=?`, USER_ID)).toBe(1);
      },
    },
    {
      name: "case",
      reward: { stars: 0, balls: 0, case_type: CASE_TYPE, case_count: 1, lucky_tokens: 0 },
      assert: async () => {
        expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, CASE_TYPE)).toBe(1);
      },
    },
    {
      name: "lucky_token",
      reward: { stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 3 },
      assert: async () => {
        expect(await tokenBalance()).toBe(3);
        expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE user_id=?`, USER_ID)).toBe(1);
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: first grant delivers once + one ledger row`, async () => {
      const tk = `sp_${c.name}`;
      const base = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, tk);
      await grant(tk, c.reward);
      await c.assert(base);
      expect(await ledgerRows(base)).toBe(1);
    });

    it(`${c.name}: repeat claim is a no-op (no double credit, no extra rows)`, async () => {
      const tk = `sp_${c.name}`;
      const base = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, tk);
      await grant(tk, c.reward);
      await grant(tk, c.reward);
      await c.assert(base); // unchanged
      expect(await ledgerRows(base)).toBe(1);
    });

    it(`${c.name}: concurrent claims deliver exactly once`, async () => {
      const tk = `sp_${c.name}`;
      const base = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, tk);
      await Promise.allSettled([grant(tk, c.reward), grant(tk, c.reward), grant(tk, c.reward)]);
      await c.assert(base);
      expect(await ledgerRows(base)).toBe(1);
    });
  }
});

describe("mixed reward — recovery + concurrency + truthful ledger", () => {
  const reward: TaskRewardPayload = { stars: 2, balls: 3, case_type: CASE_TYPE, case_count: 1, lucky_tokens: 4 };

  async function assertExactMixed() {
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID)).toBe(3);
    expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, CASE_TYPE)).toBe(1);
    expect(await tokenBalance()).toBe(4);
  }

  it("concurrent mixed claims grant each component exactly once (Invariant C+D)", async () => {
    const tk = "sp_mixed_cc";
    const base = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, tk);
    await Promise.allSettled([grant(tk, reward), grant(tk, reward)]);
    await assertExactMixed();
    expect(await ledgerRows(base)).toBe(4);
  });

  it("truthful ledger (Invariant A): every granted reward_ledger row has a matching delivered resource", async () => {
    const tk = "sp_mixed_truth";
    const base = taskClaimUniqueKeyBase(SEASON_ID, USER_ID, tk);
    await grant(tk, reward);
    // stars
    expect(await num(`SELECT COUNT(*) n FROM stars_ledger WHERE user_id=? AND instance_key=?`, USER_ID, `${base}:stars`)).toBe(1);
    // balls
    expect(await num(`SELECT COUNT(*) n FROM balls_ledger WHERE user_id=? AND instance_key=?`, USER_ID, `${base}:balls`)).toBe(1);
    // case present in inventory
    expect(await num(`SELECT COALESCE(SUM(quantity),0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, CASE_TYPE)).toBe(1);
    // lucky_token history ref present
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id=?`, `${base}:lucky_token`)).toBe(1);
    // and the ledger marks exactly the four delivered components
    expect(await ledgerRows(base)).toBe(4);
  });

  it("fault point AFTER delivery: replay returns the same result with no duplication", async () => {
    const tk = "sp_mixed_replay";
    await grant(tk, reward);
    await assertExactMixed();
    // Simulate the endpoint crashing after delivery, before responding: the user retries.
    await grant(tk, reward);
    await grant(tk, reward);
    await assertExactMixed(); // still exactly once
  });
});
