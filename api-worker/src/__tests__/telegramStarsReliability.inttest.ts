// Stage 5.4.1 — REAL bot-worker integration harness for Telegram Stars credit/refund.
// Imports the actual production functions from bot-worker (no SQL re-implementation) and runs them
// against a miniflare D1, proving atomic credit, refund-before-credit safety (X5-3), idempotency,
// concurrency and partial/zero recovery.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { creditTelegramStarOrder, refundTelegramStarOrder } from "../../../bot-worker/src/index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-xtr");
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;

async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}
const balls = (uid: number) => num(`SELECT COALESCE(balls,0) n FROM users WHERE id=?`, uid);
const orderRow = (orderId: string) => db.prepare(`SELECT * FROM telegram_star_orders WHERE order_id=?`).bind(orderId).first() as Promise<any>;

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ball_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, balance_before INTEGER, balance_after INTEGER, operation_type TEXT, comment TEXT, admin_user_id INTEGER, open_id TEXT UNIQUE, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS telegram_star_orders (order_id TEXT PRIMARY KEY, user_id INTEGER, pack_code TEXT, pack_title TEXT, invoice_payload TEXT UNIQUE, price_xtr INTEGER, total_balls INTEGER, status TEXT, telegram_payment_charge_id TEXT UNIQUE, provider_payment_charge_id TEXT UNIQUE, last_error TEXT, created_at INTEGER, updated_at INTEGER, paid_at INTEGER, credited_at INTEGER, refunded_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS telegram_star_order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, event_type TEXT, payload_json TEXT, created_at INTEGER)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
}
async function seedOrder(o: { orderId: string; userId: number; total: number; xtr?: number; status?: string }) {
  await db.prepare(`INSERT INTO telegram_star_orders (order_id,user_id,pack_code,pack_title,invoice_payload,price_xtr,total_balls,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(o.orderId, o.userId, "pack", "Pack", `pl-${o.orderId}`, o.xtr ?? 49, o.total, o.status ?? "pending", 1, 1).run();
}
async function resetData() {
  for (const t of ["users", "ball_transactions", "telegram_star_orders", "telegram_star_order_events"]) await db.prepare(`DELETE FROM ${t}`).run();
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db }; // no ADMIN_IDS / BOT_TOKEN → admin notify is a no-op (no external calls)
  await createSchema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(resetData);

describe("purchase credit (real creditTelegramStarOrder)", () => {
  it("normal credit: balls += total, status credited, one receipt", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 55 });
    const r = await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A", paidAt: 1 });
    expect(r.credited).toBe(true);
    expect(await balls(1)).toBe(55);
    expect(String((await orderRow("A")).status)).toBe("credited");
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='stars_order:A'`)).toBe(1);
  });
  it("duplicate sequential credit does not double", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 55 });
    await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    const r2 = await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    expect(r2.credited).toBe(false);
    expect(await balls(1)).toBe(55);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='stars_order:A'`)).toBe(1);
  });
  it("concurrent duplicate credit credits exactly once", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 55 });
    const o = await orderRow("A");
    await Promise.allSettled([
      creditTelegramStarOrder(env, o, { telegramPaymentChargeId: "ch-A" }),
      creditTelegramStarOrder(env, o, { telegramPaymentChargeId: "ch-A" }),
      creditTelegramStarOrder(env, o, { telegramPaymentChargeId: "ch-A" }),
    ]);
    expect(await balls(1)).toBe(55);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='stars_order:A'`)).toBe(1);
  });
});

describe("refund (real refundTelegramStarOrder)", () => {
  it("full recovery: credited 100, balance 100 → recover 100, balance 0", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 100 });
    await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    expect(await balls(1)).toBe(100);
    await refundTelegramStarOrder(env, await orderRow("A"), { telegram_payment_charge_id: "ch-A" });
    expect(await balls(1)).toBe(0);
    expect(String((await orderRow("A")).status)).toBe("refunded");
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='stars_refund:A'`)).toBe(1);
  });
  it("partial recovery: credited 100, then spent down to 30 → recover 30, balance 0, partial flag", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 100 });
    await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    await db.prepare(`UPDATE users SET balls = 30 WHERE id = 1`).run(); // spent 70 elsewhere
    await refundTelegramStarOrder(env, await orderRow("A"), {});
    expect(await balls(1)).toBe(0);
    expect(await num(`SELECT amount n FROM ball_transactions WHERE open_id='stars_refund:A'`)).toBe(-30);
    expect(String((await orderRow("A")).last_error)).toBe("PARTIAL_BALLS_RECOVERY");
  });
  it("zero recovery: balance 0 → recover 0, balance stays 0 (not negative), refunded", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 100 });
    await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    await db.prepare(`UPDATE users SET balls = 0 WHERE id = 1`).run();
    await refundTelegramStarOrder(env, await orderRow("A"), {});
    expect(await balls(1)).toBe(0);
    expect(String((await orderRow("A")).status)).toBe("refunded");
    expect(await num(`SELECT amount n FROM ball_transactions WHERE open_id='stars_refund:A'`)).toBe(0);
  });
  it("duplicate refund does not deduct twice", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 0)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 100 });
    await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    await refundTelegramStarOrder(env, await orderRow("A"), {});
    await refundTelegramStarOrder(env, await orderRow("A"), {});
    expect(await balls(1)).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='stars_refund:A'`)).toBe(1);
  });
});

describe("X5-3 — refund-before-credit must NOT touch the user's other balls (load-bearing)", () => {
  it("user has 50 non-XTR balls, order promises 100, refund-before-credit → balance stays 50, recover 0", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 50)`).run(); // 50 from other sources
    await seedOrder({ orderId: "A", userId: 1, total: 100, status: "pending" }); // NOT credited, no purchase tx
    await refundTelegramStarOrder(env, await orderRow("A"), {});
    expect(await balls(1)).toBe(50); // untouched
    const o = await orderRow("A");
    expect(String(o.status)).toBe("refunded");
    expect(String(o.last_error)).toBe("REFUNDED_BEFORE_CREDIT");
    expect(await num(`SELECT amount n FROM ball_transactions WHERE open_id='stars_refund:A'`)).toBe(0);
  });
  it("a credit AFTER refund-before-credit is rejected (no balls added)", async () => {
    await db.prepare(`INSERT INTO users (id, balls) VALUES (1, 50)`).run();
    await seedOrder({ orderId: "A", userId: 1, total: 100, status: "pending" });
    await refundTelegramStarOrder(env, await orderRow("A"), {});
    const r = await creditTelegramStarOrder(env, await orderRow("A"), { telegramPaymentChargeId: "ch-A" });
    expect(r.credited).toBe(false);
    expect(await balls(1)).toBe(50);
    expect(await num(`SELECT COUNT(*) n FROM ball_transactions WHERE open_id='stars_order:A'`)).toBe(0);
  });
});
