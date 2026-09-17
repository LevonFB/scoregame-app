// Referral program v1 (migration 0125, docs/referral-v1.md) — exercises the REAL
// exported processReferralActivation() against a local D1: activation flip,
// invitee welcome token, inviter per-friend case, milestone grants, daily-cap
// deferral with catch-up, idempotency of every payout, and the disabled switch.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { processReferralActivation, resetReferralConfigCache } from "../index";
import { REFERRAL_CONFIG_KEY } from "../referral";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-referral");
const INVITER = 9001;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;
const ctx = { waitUntil() {} } as any; // notification path is gated on TELEGRAM_BOT_TOKEN (absent here)

async function run(sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}
async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, balls INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, referred_by INTEGER, referral_activated_at INTEGER, referral_rewarded_at INTEGER, acquired_via TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by) WHERE referred_by IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`,
    `CREATE TABLE IF NOT EXISTS case_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, case_type TEXT, amount INTEGER, quantity_before INTEGER, quantity_after INTEGER, operation_type TEXT, comment TEXT, created_at INTEGER, idempotency_key TEXT UNIQUE)`,
    `CREATE TABLE IF NOT EXISTS fortune_spins (user_id INTEGER NOT NULL PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS lucky_token_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, ref_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
}

async function resetData() {
  for (const t of ["users", "app_config", "user_cases", "case_transactions", "fortune_spins", "lucky_token_transactions"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  resetReferralConfigCache();
  await run(`INSERT INTO users (id, first_name) VALUES (?, 'Inviter')`, INVITER);
}

async function addFriend(id: number, opts?: { activatedAt?: number | null; rewardedAt?: number | null }) {
  await run(
    `INSERT INTO users (id, first_name, referred_by, referral_activated_at, referral_rewarded_at) VALUES (?, 'F', ?, ?, ?)`,
    id, INVITER, opts?.activatedAt ?? null, opts?.rewardedAt ?? null
  );
}

async function setConfig(config: unknown) {
  await run(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    REFERRAL_CONFIG_KEY, JSON.stringify(config), Date.now()
  );
  resetReferralConfigCache();
}

const caseQty = (userId: number, caseType: string) =>
  num(`SELECT COALESCE(quantity,0) n FROM user_cases WHERE user_id = ? AND case_type = ?`, userId, caseType);
const tokenQty = (userId: number) =>
  num(`SELECT COALESCE(quantity,0) n FROM fortune_spins WHERE user_id = ?`, userId);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ configPath: path.resolve(process.cwd(), "wrangler.toml"), persist: { path: PERSIST } });
  env = { DB: (proxy.env as any).DB }; // deliberately NO TELEGRAM_BOT_TOKEN → notify path stays off
  db = env.DB;
  await createSchema();
});

afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});

beforeEach(resetData);

describe("processReferralActivation", () => {
  it("is a no-op for users without referred_by", async () => {
    await run(`INSERT INTO users (id) VALUES (1)`);
    expect(await processReferralActivation(env, ctx, 1, "X")).toBeNull();
    expect(await num(`SELECT COUNT(*) n FROM case_transactions`)).toBe(0);
  });

  it("activates: invitee gets the welcome token, inviter gets the per-friend daily case", async () => {
    await addFriend(101);
    const toast = await processReferralActivation(env, ctx, 101, "Друг");
    expect(toast).toEqual({ granted: true, label: "Фартовый жетон" });
    expect(await tokenQty(101)).toBe(1);
    expect(await caseQty(INVITER, "daily_free")).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE id=101 AND referral_activated_at IS NOT NULL AND referral_rewarded_at IS NOT NULL`)).toBe(1);
  });

  it("is idempotent: a second pick after activation pays nothing extra", async () => {
    await addFriend(102);
    await processReferralActivation(env, ctx, 102, "Друг");
    const again = await processReferralActivation(env, ctx, 102, "Друг");
    expect(again).toBeNull();
    expect(await tokenQty(102)).toBe(1);
    expect(await caseQty(INVITER, "daily_free")).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM lucky_token_transactions WHERE user_id = 102`)).toBe(1);
  });

  it("grants the 3-friend premium milestone exactly once", async () => {
    await addFriend(201, { activatedAt: Date.now() - 1000, rewardedAt: Date.now() - 1000 });
    await addFriend(202, { activatedAt: Date.now() - 900, rewardedAt: Date.now() - 900 });
    await addFriend(203);
    await processReferralActivation(env, ctx, 203, "Третий");
    expect(await caseQty(INVITER, "premium")).toBe(1);
    // Another friend's activation must not re-grant the same milestone.
    await addFriend(204);
    await processReferralActivation(env, ctx, 204, "Четвёртый");
    expect(await caseQty(INVITER, "premium")).toBe(1);
    expect(await caseQty(INVITER, "daily_free")).toBe(2); // friends 203 + 204
  });

  it("defers per-friend rewards over the daily cap and catches up on the next activation", async () => {
    await setConfig({
      enabled: true,
      invitee_reward: { type: "lucky_token", amount: 1 },
      per_friend_reward: { type: "daily_case", amount: 1 },
      milestones: [],
      daily_cap: 2,
    });
    // Two rewards already spent inside the rolling 24h window.
    await addFriend(301, { activatedAt: Date.now() - 5000, rewardedAt: Date.now() - 5000 });
    await addFriend(302, { activatedAt: Date.now() - 4000, rewardedAt: Date.now() - 4000 });
    await addFriend(303);
    await processReferralActivation(env, ctx, 303, "Сверх капа");
    // 303 activated (and got the welcome token) but the inviter reward is deferred.
    expect(await tokenQty(303)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE id=303 AND referral_activated_at IS NOT NULL`)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE id=303 AND referral_rewarded_at IS NOT NULL`)).toBe(0);
    expect(await caseQty(INVITER, "daily_free")).toBe(0);
    // A day later the cap window is clear: friend 304 activates → sweep pays BOTH 303 and 304.
    const dayAgo = Date.now() - 25 * 3600_000;
    await run(`UPDATE users SET referral_rewarded_at = ? WHERE id IN (301, 302)`, dayAgo);
    await addFriend(304);
    await processReferralActivation(env, ctx, 304, "Новый день");
    expect(await caseQty(INVITER, "daily_free")).toBe(2);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE referred_by = ? AND referral_rewarded_at IS NULL`, INVITER)).toBe(0);
  });

  it("does nothing when the program is disabled", async () => {
    await setConfig({
      enabled: false,
      invitee_reward: { type: "lucky_token", amount: 1 },
      per_friend_reward: { type: "daily_case", amount: 1 },
      milestones: [],
      daily_cap: 10,
    });
    await addFriend(401);
    expect(await processReferralActivation(env, ctx, 401, "X")).toBeNull();
    expect(await tokenQty(401)).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE id=401 AND referral_activated_at IS NOT NULL`)).toBe(0);
  });

  it("falls back to defaults when the stored config is corrupt", async () => {
    await run(`INSERT INTO app_config (key, value, updated_at) VALUES (?, 'not-json{', ?)`, REFERRAL_CONFIG_KEY, Date.now());
    resetReferralConfigCache();
    await addFriend(501);
    const toast = await processReferralActivation(env, ctx, 501, "X");
    expect(toast?.granted).toBe(true); // defaults applied
    expect(await caseQty(INVITER, "daily_free")).toBe(1);
  });

  it("banned inviter earns nothing; rewards catch up after unban", async () => {
    await run(`UPDATE users SET is_banned = 1 WHERE id = ?`, INVITER);
    await addFriend(601);
    // The invitee is innocent: activation + welcome token still happen.
    const toast = await processReferralActivation(env, ctx, 601, "Друг");
    expect(toast).toEqual({ granted: true, label: "Фартовый жетон" });
    expect(await tokenQty(601)).toBe(1);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE id=601 AND referral_activated_at IS NOT NULL`)).toBe(1);
    // But the inviter gets neither the per-friend case nor milestone progress payouts.
    expect(await caseQty(INVITER, "daily_free")).toBe(0);
    expect(await num(`SELECT COUNT(*) n FROM users WHERE id=601 AND referral_rewarded_at IS NOT NULL`)).toBe(0);
    // Unban → the next activation sweep pays out the deferred reward too.
    await run(`UPDATE users SET is_banned = 0 WHERE id = ?`, INVITER);
    await addFriend(602);
    await processReferralActivation(env, ctx, 602, "Второй");
    expect(await caseQty(INVITER, "daily_free")).toBe(2); // 601 (catch-up) + 602
  });

  it("ignores a self-referral row (defense in depth — claim already blocks it)", async () => {
    await run(`UPDATE users SET referred_by = ? WHERE id = ?`, INVITER, INVITER);
    expect(await processReferralActivation(env, ctx, INVITER, "X")).toBeNull();
    expect(await num(`SELECT COUNT(*) n FROM case_transactions`)).toBe(0);
  });
});
