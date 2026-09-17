// Stage 5.2 — atomic/idempotent /cases/open via the real exported executeCaseOpen.
// Builds the post-0096 schema (case_opens.reward_code) on a miniflare D1 and proves: exactly-once
// charge+grant for inventory / daily-fallback / paid opens; truthful receipt; conflict; crash
// rollback; concurrency; each reward type.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { executeCaseOpen, type CaseReward } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-caseopen");
const USER_ID = 7701;
const DAY = new Date().toISOString().slice(0, 10);

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, activated_at TEXT, finalized_at TEXT, archived_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1, notes TEXT, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0, extra_league_slots INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER, season_number INTEGER, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, gold_avatar_frame INTEGER DEFAULT 0, PRIMARY KEY (user_id, season_number))`,
    `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`,
    `CREATE TABLE IF NOT EXISTS daily_cases (user_id INTEGER NOT NULL, day TEXT NOT NULL, earned INTEGER DEFAULT 0, earned_at INTEGER, opened_at INTEGER, PRIMARY KEY (user_id, day))`,
    // case_opens with the 0096 reward_code column.
    `CREATE TABLE IF NOT EXISTS case_opens (id INTEGER PRIMARY KEY AUTOINCREMENT, open_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, case_type TEXT NOT NULL, reward_type TEXT NOT NULL, reward_amount INTEGER NOT NULL DEFAULT 1, balls_spent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, reward_code TEXT)`,
    `CREATE TABLE IF NOT EXISTS ball_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, open_id TEXT UNIQUE, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS purchase_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item_type TEXT NOT NULL, balls_cost INTEGER NOT NULL, created_at INTEGER NOT NULL, operation_id TEXT)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_history_operation_id ON purchase_history(operation_id) WHERE operation_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS fortune_spins (user_id INTEGER NOT NULL PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS lucky_token_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, ref_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await db.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1)`).run();
}
const createUserBoosts = () => db.prepare(`CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`).run();

async function resetData(opts: { balls?: number; dailyFreeQty?: number; premiumQty?: number; dailyEarned?: boolean } = {}) {
  await createUserBoosts();
  for (const t of ["users", "user_season_progress", "stars_ledger", "user_cases", "daily_cases", "case_opens", "ball_transactions", "purchase_history", "user_boosts", "fortune_spins", "lucky_token_transactions"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare(`INSERT INTO users (id, balls, extra_league_slots) VALUES (?, ?, 0)`).bind(USER_ID, opts.balls ?? 0).run();
  if (opts.dailyFreeQty) await db.prepare(`INSERT INTO user_cases (user_id, case_type, quantity) VALUES (?, 'daily_free', ?)`).bind(USER_ID, opts.dailyFreeQty).run();
  if (opts.premiumQty) await db.prepare(`INSERT INTO user_cases (user_id, case_type, quantity) VALUES (?, 'premium', ?)`).bind(USER_ID, opts.premiumQty).run();
  if (opts.dailyEarned) await db.prepare(`INSERT INTO daily_cases (user_id, day, earned, earned_at, opened_at) VALUES (?, ?, 1, 1, NULL)`).bind(USER_ID, DAY).run();
}

const open = (caseType: string, openId: string, reward: CaseReward, o: { cost?: number; inventoryBacked?: boolean } = {}) =>
  executeCaseOpen(env as any, { userId: USER_ID, caseType, openId, cost: o.cost ?? 0, inventoryBacked: o.inventoryBacked ?? true, rollFn: () => reward });

const balls = () => num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID);
const qty = (t: string) => num(`SELECT COALESCE(quantity,0) n FROM user_cases WHERE user_id=? AND case_type=?`, USER_ID, t);
const opens = (openId: string) => num(`SELECT COUNT(*) n FROM case_opens WHERE open_id=?`, openId);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await createSchema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });

describe("inventory free case", () => {
  beforeEach(() => resetData({ dailyFreeQty: 1 }));
  it("opens once: quantity 1→0, reward granted, one receipt; replay + concurrent are no-ops", async () => {
    const r = await open("daily_free", "op-inv", { type: "balls", amount: 5 });
    expect(r.ok).toBe(true);
    expect(await qty("daily_free")).toBe(0);
    expect(await balls()).toBe(5);
    expect(await opens("op-inv")).toBe(1);
    // replay
    const r2 = await open("daily_free", "op-inv", { type: "balls", amount: 999 });
    expect(r2.ok && (r2 as any).duplicate).toBe(true);
    expect(await balls()).toBe(5); // unchanged, replay returns stored reward not the new roll
    // concurrent
    await Promise.allSettled([open("daily_free", "op-inv", { type: "balls", amount: 1 }), open("daily_free", "op-inv", { type: "balls", amount: 1 })]);
    expect(await balls()).toBe(5);
    expect(await opens("op-inv")).toBe(1);
  });

  it("two different openIds with quantity 1 → exactly one success, other NO_FREE_CASE; quantity never negative", async () => {
    const a = await open("daily_free", "op-a", { type: "balls", amount: 2 });
    const b = await open("daily_free", "op-b", { type: "balls", amount: 2 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect((b as any).error).toBe("NO_FREE_CASE");
    expect(await qty("daily_free")).toBe(0);
    expect(await balls()).toBe(2);
  });
});

describe("zero-cost non-inventory guard", () => {
  beforeEach(() => resetData({ balls: 50 }));
  it("a zero-cost case with no consumable resource → CASE_NOT_OPENABLE (no free farm), nothing written", async () => {
    const r = await open("mystery", "op-zero", { type: "balls", amount: 100 }, { cost: 0, inventoryBacked: false });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("CASE_NOT_OPENABLE");
    // A fresh openId must not help either — the farm loop is closed.
    const r2 = await open("mystery", "op-zero-2", { type: "balls", amount: 100 }, { cost: 0, inventoryBacked: false });
    expect(r2.ok).toBe(false);
    expect(await balls()).toBe(50);
    expect(await opens("op-zero")).toBe(0);
  });

  it("malformed openId → INVALID_OPEN_ID, nothing written", async () => {
    const r = await open("daily_free", "x".repeat(65), { type: "balls", amount: 1 });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("INVALID_OPEN_ID");
  });
});

describe("daily fallback", () => {
  beforeEach(() => resetData({ dailyEarned: true })); // no inventory, but earned daily case
  it("opens via daily_cases: sets opened_at, grants once; second daily open → NO_FREE_CASE", async () => {
    const r = await open("daily_free", "op-daily", { type: "stars", amount: 4 });
    expect(r.ok).toBe(true);
    expect(await num(`SELECT COUNT(*) n FROM daily_cases WHERE user_id=? AND opened_at IS NOT NULL`, USER_ID)).toBe(1);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(4);
    const r2 = await open("daily_free", "op-daily-2", { type: "stars", amount: 4 });
    expect(r2.ok).toBe(false);
    expect((r2 as any).error).toBe("NO_FREE_CASE");
  });
});

describe("paid premium case", () => {
  beforeEach(() => resetData({ balls: 10 })); // no premium inventory, cost 7
  const paid = (openId: string, reward: CaseReward) => open("premium", openId, reward, { cost: 7, inventoryBacked: true });
  it("charges once, grants once, writes ball_transactions(open_id) + purchase_history(case:openId)", async () => {
    const r = await paid("op-paid", { type: "extra_joker", amount: 1 });
    expect(r.ok).toBe(true);
    expect(await balls()).toBe(3);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type='extra_joker'`, USER_ID)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='op-paid'`)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM purchase_history WHERE operation_id='case:op-paid'`)).toBe(1);
    // replay
    await paid("op-paid", { type: "extra_joker", amount: 1 });
    expect(await balls()).toBe(3);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=?`, USER_ID)).toBe(1);
  });
  it("insufficient balance → INSUFFICIENT_BALLS, no charge/receipt/item", async () => {
    await resetData({ balls: 3 });
    const r = await paid("op-poor", { type: "balls", amount: 1 });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("INSUFFICIENT_BALLS");
    expect(await balls()).toBe(3);
    expect(await opens("op-poor")).toBe(0);
  });
  it("concurrent same openId charges exactly once", async () => {
    await Promise.allSettled([paid("op-cc", { type: "balls", amount: 1 }), paid("op-cc", { type: "balls", amount: 1 }), paid("op-cc", { type: "balls", amount: 1 })]);
    // cost 7 from 10 → 3, plus 1 ball reward = 4; exactly once.
    expect(await balls()).toBe(4);
    expect(await opens("op-cc")).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='op-cc'`)).toBe(1);
  });
});

describe("conflict + crash + reward types", () => {
  beforeEach(() => resetData({ dailyFreeQty: 1, balls: 50, premiumQty: 5 }));
  it("same openId, different caseType → CASE_OPEN_OPERATION_CONFLICT", async () => {
    await open("daily_free", "op-conf", { type: "balls", amount: 1 });
    const r = await open("premium", "op-conf", { type: "balls", amount: 1 }, { cost: 7, inventoryBacked: true });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("CASE_OPEN_OPERATION_CONFLICT");
  });

  it("crash INSIDE batch (drop user_boosts, reward=extra_joker) rolls back; no receipt, quantity intact; retry works", async () => {
    await db.prepare(`DROP TABLE user_boosts`).run();
    let threw = false;
    try { await open("daily_free", "op-crash", { type: "extra_joker", amount: 1 }); } catch { threw = true; }
    expect(threw).toBe(true);
    expect(await opens("op-crash")).toBe(0);
    expect(await qty("daily_free")).toBe(1); // not consumed
    await createUserBoosts();
    const r = await open("daily_free", "op-crash", { type: "extra_joker", amount: 1 });
    expect(r.ok).toBe(true);
    expect(await qty("daily_free")).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type='extra_joker'`, USER_ID)).toBe(1);
  });

  it("each reward type is granted exactly once via inventory open", async () => {
    await resetData({ dailyFreeQty: 6 });
    await open("daily_free", "rt-stars", { type: "stars", amount: 3 });
    await open("daily_free", "rt-balls", { type: "balls", amount: 4 });
    await open("daily_free", "rt-joker", { type: "extra_joker", amount: 1 });
    await open("daily_free", "rt-league", { type: "extra_league", amount: 1 });
    await open("daily_free", "rt-token", { type: "lucky_token", amount: 2 });
    await open("daily_free", "rt-case", { type: "case", amount: 1, code: "premium" });
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(3);
    expect(await balls()).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type='extra_joker'`, USER_ID)).toBe(1);
    expect(await num(`SELECT COALESCE(extra_league_slots,0) n FROM users WHERE id=?`, USER_ID)).toBe(1);
    expect(await num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id=?`, USER_ID)).toBe(2);
    expect(await qty("premium")).toBe(1); // nested case granted, NOT auto-opened
    expect(await qty("daily_free")).toBe(0); // all 6 consumed
  });
});
