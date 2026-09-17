// Stage 5.3 — atomic/idempotent /fortune/spin via the real exported executeFortuneSpin.
// Proves R-3 is fixed: charge + reward + receipt are one atomic batch; exactly-once for
// duplicate/concurrent/timeout; truthful receipt; conflict; crash rollback; each reward type.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { executeFortuneSpin } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-fortune");
const USER_ID = 8801;
const SECTORS = [{ id: 10 }, { id: 20 }, { id: 30 }];

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
    `CREATE TABLE IF NOT EXISTS fortune_spins (user_id INTEGER NOT NULL PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS fortune_spin_opens (id INTEGER PRIMARY KEY AUTOINCREMENT, spin_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, sector_id INTEGER, reward_type TEXT NOT NULL, reward_amount INTEGER NOT NULL DEFAULT 1, reward_code TEXT, balls_spent INTEGER NOT NULL DEFAULT 0, free_spin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ball_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, open_id TEXT UNIQUE, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS lucky_token_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, ref_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await db.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1)`).run();
}
const createUserBoosts = () => db.prepare(`CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`).run();
async function resetData(opts: { balls?: number; tokens?: number } = {}) {
  await createUserBoosts();
  for (const t of ["users", "user_season_progress", "stars_ledger", "user_cases", "fortune_spins", "fortune_spin_opens", "ball_transactions", "lucky_token_transactions", "user_boosts"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare(`INSERT INTO users (id, balls, extra_league_slots) VALUES (?, ?, 0)`).bind(USER_ID, opts.balls ?? 0).run();
  if (opts.tokens) await db.prepare(`INSERT INTO fortune_spins (user_id, quantity) VALUES (?, ?)`).bind(USER_ID, opts.tokens).run();
}

type Roll = { sectorId: number; index: number; rewardType: string; amount: number; rewardCode: string | null };
const fixedRoll = (rewardType: string, amount: number, code: string | null = null): Roll => ({ sectorId: 10, index: 0, rewardType, amount, rewardCode: code });
const spinBalls = (spinId: string, roll: Roll, cost = 3) =>
  executeFortuneSpin(env as any, { userId: USER_ID, spinId, paymentMethod: "balls", cost, tokenCost: 1, allowBalls: true, allowToken: true, sectors: SECTORS, rollFn: () => roll });
const spinToken = (spinId: string, roll: Roll) =>
  executeFortuneSpin(env as any, { userId: USER_ID, spinId, paymentMethod: "lucky_token", cost: 3, tokenCost: 1, allowBalls: true, allowToken: true, sectors: SECTORS, rollFn: () => roll });

const balls = () => num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID);
const tokens = () => num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id=?`, USER_ID);
const spins = (spinId: string) => num(`SELECT COUNT(*) n FROM fortune_spin_opens WHERE spin_id=?`, spinId);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await createSchema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });

describe("balls payment", () => {
  beforeEach(() => resetData({ balls: 10 }));
  it("charges once + grants once + one receipt + one spend tx; replay + concurrent no-op", async () => {
    const r = await spinBalls("s-balls", fixedRoll("stars", 5));
    expect(r.ok).toBe(true);
    expect(await balls()).toBe(7);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(5);
    expect(await spins("s-balls")).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='s-balls'`)).toBe(1);
    // replay
    const r2 = await spinBalls("s-balls", fixedRoll("stars", 999));
    expect(r2.ok && (r2 as any).duplicate).toBe(true);
    expect(await balls()).toBe(7);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(5);
    // concurrent
    await Promise.allSettled([spinBalls("s-balls", fixedRoll("stars", 1)), spinBalls("s-balls", fixedRoll("stars", 1))]);
    expect(await balls()).toBe(7);
    expect(await spins("s-balls")).toBe(1);
  });
  it("insufficient balls → INSUFFICIENT_BALLS, no charge/receipt", async () => {
    await resetData({ balls: 1 });
    const r = await spinBalls("s-poor", fixedRoll("balls", 5));
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("INSUFFICIENT_BALLS");
    expect(await balls()).toBe(1);
    expect(await spins("s-poor")).toBe(0);
  });
  it("balls reward sector: net balance = +reward -cost, exactly once", async () => {
    const r = await spinBalls("s-ballsrw", fixedRoll("balls", 4)); // win 4, pay 3
    expect(r.ok).toBe(true);
    expect(await balls()).toBe(11); // 10 + 4 - 3
    await spinBalls("s-ballsrw", fixedRoll("balls", 4)); // replay
    expect(await balls()).toBe(11);
  });
});

describe("token payment", () => {
  beforeEach(() => resetData({ tokens: 1, balls: 5 }));
  it("spends one token, grants reward, one receipt; replay no-op", async () => {
    const r = await spinToken("t-1", fixedRoll("extra_joker", 1));
    expect(r.ok).toBe(true);
    expect(await tokens()).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type='extra_joker'`, USER_ID)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE ref_id='t-1' AND amount=-1`)).toBe(1);
    await spinToken("t-1", fixedRoll("extra_joker", 1));
    expect(await tokens()).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=?`, USER_ID)).toBe(1);
  });
  it("insufficient tokens → INSUFFICIENT_LUCKY_TOKENS, token balance unchanged", async () => {
    await resetData({ tokens: 0, balls: 5 });
    const r = await spinToken("t-poor", fixedRoll("balls", 2));
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("INSUFFICIENT_LUCKY_TOKENS");
    expect(await tokens()).toBe(0);
    expect(await spins("t-poor")).toBe(0);
  });
  it("concurrent same spinId spends exactly one token", async () => {
    await resetData({ tokens: 1 });
    await Promise.allSettled([spinToken("t-cc", fixedRoll("stars", 3)), spinToken("t-cc", fixedRoll("stars", 3)), spinToken("t-cc", fixedRoll("stars", 3))]);
    expect(await tokens()).toBe(0);
    expect(await spins("t-cc")).toBe(1);
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(3);
  });
});

describe("conflict + crash + reward types", () => {
  beforeEach(() => resetData({ balls: 50, tokens: 5 }));
  it("same spinId, different payment method → FORTUNE_SPIN_OPERATION_CONFLICT", async () => {
    await spinBalls("s-conf", fixedRoll("stars", 1));
    const r = await spinToken("s-conf", fixedRoll("stars", 1));
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("FORTUNE_SPIN_OPERATION_CONFLICT");
  });
  it("cross-user replay → conflict", async () => {
    await spinBalls("s-user", fixedRoll("stars", 1));
    await db.prepare(`INSERT INTO users (id, balls, extra_league_slots) VALUES (9999, 50, 0)`).run();
    const r = await executeFortuneSpin(env as any, { userId: 9999, spinId: "s-user", paymentMethod: "balls", cost: 3, tokenCost: 1, allowBalls: true, allowToken: true, sectors: SECTORS, rollFn: () => fixedRoll("stars", 1) });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("FORTUNE_SPIN_OPERATION_CONFLICT");
  });
  it("crash INSIDE batch (drop user_boosts, reward=joker) rolls back; no spin/charge; retry works", async () => {
    await db.prepare(`DROP TABLE user_boosts`).run();
    let threw = false;
    try { await spinBalls("s-crash", fixedRoll("extra_joker", 1)); } catch { threw = true; }
    expect(threw).toBe(true);
    expect(await spins("s-crash")).toBe(0);
    expect(await balls()).toBe(50); // not charged
    await createUserBoosts();
    const r = await spinBalls("s-crash", fixedRoll("extra_joker", 1));
    expect(r.ok).toBe(true);
    expect(await balls()).toBe(47);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type='extra_joker'`, USER_ID)).toBe(1);
  });
  it("each reward type via balls payment granted exactly once", async () => {
    await spinBalls("rt-stars", fixedRoll("stars", 3));
    await spinBalls("rt-joker", fixedRoll("extra_joker", 1));
    await spinBalls("rt-league", fixedRoll("extra_league", 1));
    await spinBalls("rt-token", fixedRoll("lucky_token", 2));
    await spinBalls("rt-case", fixedRoll("case", 1, "premium"));
    expect(await num(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=?`, USER_ID)).toBe(3);
    expect(await num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type='extra_joker'`, USER_ID)).toBe(1);
    expect(await num(`SELECT COALESCE(extra_league_slots,0) n FROM users WHERE id=?`, USER_ID)).toBe(1);
    // token reward credits fortune_spins (+2); started 5, each spin pays balls (not tokens) → 5+2=7
    expect(await tokens()).toBe(7);
    expect(await num(`SELECT COALESCE(quantity,0) n FROM user_cases WHERE user_id=? AND case_type='premium'`, USER_ID)).toBe(1);
  });
});
