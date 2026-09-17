// Stage 5 — idempotency/reliability for POST /shop/buy via the real exported executeShopPurchase.
// Builds the post-0095 schema (purchase_history.operation_id UNIQUE) on a miniflare D1 and proves:
// exactly-once charge+grant on duplicate / concurrent / timeout-retry; truthful failure on
// insufficient/inactive; no item-without-charge.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { executeShopPurchase } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-shop");
const USER_ID = 6101;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0, extra_league_slots INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS shop_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, price_balls INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS ball_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, open_id TEXT UNIQUE, created_at INTEGER)`,
    // purchase_history with the 0095 operation_id column + partial unique index.
    `CREATE TABLE IF NOT EXISTS purchase_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item_type TEXT NOT NULL, balls_cost INTEGER NOT NULL, created_at INTEGER NOT NULL, operation_id TEXT)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_history_operation_id ON purchase_history(operation_id) WHERE operation_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await db.prepare(`INSERT OR REPLACE INTO shop_boosts (code,title,price_balls,is_active) VALUES ('extra_joker','Доп. Джокер',3,1)`).run();
  await db.prepare(`INSERT OR REPLACE INTO shop_boosts (code,title,price_balls,is_active) VALUES ('double_chance','Двойной шанс',5,1)`).run();
  await db.prepare(`INSERT OR REPLACE INTO shop_boosts (code,title,price_balls,is_active) VALUES ('extra_league','Доп. Лига',12,1)`).run();
  await db.prepare(`INSERT OR REPLACE INTO shop_boosts (code,title,price_balls,is_active) VALUES ('retired','Retired',1,0)`).run();
}
async function resetData(balls = 100) {
  for (const t of ["users", "ball_transactions", "purchase_history", "user_boosts"]) await db.prepare(`DELETE FROM ${t}`).run();
  await db.prepare(`INSERT INTO users (id, balls, extra_league_slots) VALUES (?, ?, 0)`).bind(USER_ID, balls).run();
}
const balls = () => num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, USER_ID);
const boostCount = (t: string) => num(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND boost_type=?`, USER_ID, t);
const purchaseCount = () => num(`SELECT COUNT(*) n FROM purchase_history WHERE user_id=?`, USER_ID);
const txCount = () => num(`SELECT COUNT(*) n FROM ball_transactions WHERE user_id=?`, USER_ID);
const buy = (item: string, op: string) => executeShopPurchase(env as any, USER_ID, item, op);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await createSchema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(() => resetData(100));

describe("executeShopPurchase — success + idempotency", () => {
  it("buys a boost once: charges cost, grants one boost, one tx, one purchase row", async () => {
    const r = await buy("extra_joker", "op-1");
    expect(r.ok).toBe(true);
    expect(await balls()).toBe(97);
    expect(await boostCount("extra_joker")).toBe(1);
    expect(await txCount()).toBe(1);
    expect(await purchaseCount()).toBe(1);
  });

  it("duplicate sequential (same operationId) does NOT double-charge or double-grant", async () => {
    await buy("double_chance", "op-dup");
    const r2 = await buy("double_chance", "op-dup");
    expect(r2.ok).toBe(true);
    expect((r2 as any).duplicate).toBe(true);
    expect(await balls()).toBe(95); // charged once (cost 5)
    expect(await boostCount("double_chance")).toBe(1);
    expect(await txCount()).toBe(1);
    expect(await purchaseCount()).toBe(1);
  });

  it("concurrent duplicate (same operationId) charges+grants exactly once", async () => {
    await Promise.allSettled([buy("extra_joker", "op-cc"), buy("extra_joker", "op-cc"), buy("extra_joker", "op-cc")]);
    expect(await balls()).toBe(97);
    expect(await boostCount("extra_joker")).toBe(1);
    expect(await txCount()).toBe(1);
    expect(await purchaseCount()).toBe(1);
  });

  it("extra_league increments the slot exactly once per operationId", async () => {
    await buy("extra_league", "op-lg");
    await buy("extra_league", "op-lg"); // replay
    expect(await balls()).toBe(88); // 100 - 12, once
    expect(await num(`SELECT COALESCE(extra_league_slots,0) n FROM users WHERE id=?`, USER_ID)).toBe(1);
    expect(await purchaseCount()).toBe(1);
  });

  it("distinct operationIds are independent purchases", async () => {
    await buy("extra_joker", "op-a");
    await buy("extra_joker", "op-b");
    expect(await balls()).toBe(94); // 100 - 3 - 3
    expect(await boostCount("extra_joker")).toBe(2);
    expect(await purchaseCount()).toBe(2);
  });
});

describe("executeShopPurchase — failure paths (truthful, no partial)", () => {
  it("missing operationId → error, nothing changes", async () => {
    const r = await buy("extra_joker", "");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("OPERATION_ID_REQUIRED");
    expect(await balls()).toBe(100);
    expect(await purchaseCount()).toBe(0);
  });

  it("inactive item → error, no charge, no claim row left behind", async () => {
    const r = await buy("retired", "op-x");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("Unknown or inactive item");
    expect(await balls()).toBe(100);
    expect(await purchaseCount()).toBe(0);
  });

  it("insufficient balance → error, no charge, no item, no op row (retry after top-up works)", async () => {
    await resetData(2); // < 3
    const r = await buy("extra_joker", "op-poor");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("Insufficient balls");
    expect(await balls()).toBe(2);
    expect(await boostCount("extra_joker")).toBe(0);
    expect(await purchaseCount()).toBe(0); // no orphan op row
    // Top up and retry with the SAME operationId → now succeeds exactly once.
    await db.prepare(`UPDATE users SET balls = 10 WHERE id=?`).bind(USER_ID).run();
    const r2 = await buy("extra_joker", "op-poor");
    expect(r2.ok).toBe(true);
    expect(await balls()).toBe(7);
    expect(await boostCount("extra_joker")).toBe(1);
    expect(await purchaseCount()).toBe(1);
  });
});

describe("Stage 5.1 — atomic single-batch: no orphan, conflict, crash rollback", () => {
  it("a successful purchase is fully atomic: op row ⇔ ball charge(open_id) ⇔ item (no orphan possible)", async () => {
    await buy("double_chance", "op-atomic");
    expect(await num(`SELECT COUNT(*) n FROM purchase_history WHERE operation_id='shop:op-atomic'`)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='shop:op-atomic'`)).toBe(1);
    expect(await boostCount("double_chance")).toBe(1);
    expect(await balls()).toBe(95);
  });

  it("conflicting reuse of an operationId with a DIFFERENT item → SHOP_OPERATION_CONFLICT, no second purchase", async () => {
    await buy("extra_joker", "op-conf"); // cost 3
    const r = await buy("double_chance", "op-conf"); // same op, different item
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("SHOP_OPERATION_CONFLICT");
    expect(await balls()).toBe(97); // only the first charge
    expect(await boostCount("double_chance")).toBe(0);
    expect(await purchaseCount()).toBe(1);
  });

  it("cross-user reuse of an operationId → conflict (no leak, no second purchase)", async () => {
    await buy("extra_joker", "op-user");
    // Different user replays the same operationId.
    await db.prepare(`INSERT INTO users (id, balls, extra_league_slots) VALUES (9999, 100, 0)`).run();
    const r = await executeShopPurchase(env as any, 9999, "extra_joker", "op-user");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("SHOP_OPERATION_CONFLICT");
    expect(await num(`SELECT COALESCE(balls,0) n FROM users WHERE id=9999`)).toBe(100); // not charged
  });

  it("malformed operationId (oversized / bad charset) → error, nothing written", async () => {
    for (const bad of ["x".repeat(65), "op with spaces", "op/../etc", "оп-кириллица"]) {
      const r = await buy("extra_joker", bad);
      expect(r.ok).toBe(false);
      expect((r as any).error).toBe("INVALID_OPERATION_ID");
    }
    expect(await balls()).toBe(100);
    expect(await purchaseCount()).toBe(0);
  });

  it("extra_league slot cap is atomic: concurrent purchases at cap-1 grant exactly one slot, one charge", async () => {
    await db.prepare(`UPDATE users SET extra_league_slots = 4 WHERE id=?`).bind(USER_ID).run();
    await Promise.allSettled([
      buy("extra_league", "op-cap-a"),
      buy("extra_league", "op-cap-b"),
      buy("extra_league", "op-cap-c"),
    ]);
    expect(await num(`SELECT COALESCE(extra_league_slots,0) n FROM users WHERE id=?`, USER_ID)).toBe(5); // never 6+
    expect(await balls()).toBe(88); // exactly one 12-ball charge
    expect(await purchaseCount()).toBe(1);
  });

  it("extra_league at the cap → MAX_LEAGUE_SLOTS, no charge, no op row", async () => {
    await db.prepare(`UPDATE users SET extra_league_slots = 5 WHERE id=?`).bind(USER_ID).run();
    const r = await buy("extra_league", "op-cap-full");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("MAX_LEAGUE_SLOTS");
    expect(await balls()).toBe(100);
    expect(await purchaseCount()).toBe(0);
  });

  it("crash INSIDE the batch rolls everything back (no op row, no charge, no item); retry succeeds once", async () => {
    // Force the batch to throw by removing a table it writes to.
    await db.prepare(`DROP TABLE user_boosts`).run();
    let threw = false;
    try { await buy("extra_joker", "op-crash"); } catch { threw = true; }
    expect(threw).toBe(true);
    // Nothing committed.
    expect(await purchaseCount()).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='shop:op-crash'`)).toBe(0);
    expect(await balls()).toBe(100);
    // Recover the table and retry the SAME operationId → exactly one purchase.
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`).run();
    const r = await buy("extra_joker", "op-crash");
    expect(r.ok).toBe(true);
    expect(await balls()).toBe(97);
    expect(await boostCount("extra_joker")).toBe(1);
    expect(await purchaseCount()).toBe(1);
  });
});
