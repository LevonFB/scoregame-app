// Boost refund on postponed/cancelled matches (migration 0128) — exercises the
// REAL exported refundBoostsForPostponedMatches() against a local D1: refund of
// a match-bound double_chance (boost back to available, DC flag cleared, usage
// row gone), idempotency, CANCELLED parity, the strictly-past-day guard, and
// non-targets (finished match, day-scoped extra_joker without match_id).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { refundBoostsForPostponedMatches } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-boost-refund");
const USER = 7001;
const DAY = "2026-07-10"; // safely in the past for the day >= today guard
const MATCH = "FD_1001";

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;

async function run(sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}
async function first(sql: string, ...binds: unknown[]) {
  return (await db.prepare(sql).bind(...binds).first()) as any;
}

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS matches (day TEXT NOT NULL, match_id TEXT NOT NULL, status TEXT, PRIMARY KEY (day, match_id))`,
    `CREATE TABLE IF NOT EXISTS picks (day TEXT NOT NULL, match_id TEXT NOT NULL, user_id INTEGER NOT NULL, joker INTEGER DEFAULT 0, double_chance TEXT, updated_at INTEGER, PRIMARY KEY (day, match_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, boost_type TEXT NOT NULL, status TEXT NOT NULL, purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS boost_usage (user_id INTEGER NOT NULL, day TEXT NOT NULL, boost_type TEXT NOT NULL, boost_id INTEGER NOT NULL, match_id TEXT, dc_variant TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, day))`,
    `CREATE INDEX IF NOT EXISTS idx_boost_usage_day ON boost_usage (day)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
}

async function resetData() {
  for (const t of ["matches", "picks", "user_boosts", "boost_usage"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

// One used double_chance on MATCH for USER; returns the user_boosts id.
async function seedUsedDoubleChance(matchStatus: string, opts?: { userId?: number; matchId?: string }): Promise<number> {
  const userId = opts?.userId ?? USER;
  const matchId = opts?.matchId ?? MATCH;
  await run(`INSERT OR IGNORE INTO matches (day, match_id, status) VALUES (?, ?, ?)`, DAY, matchId, matchStatus);
  await run(
    `INSERT INTO picks (day, match_id, user_id, joker, double_chance, updated_at) VALUES (?, ?, ?, 0, '1X', ?)`,
    DAY, matchId, userId, Date.now()
  );
  const ins = await run(
    `INSERT INTO user_boosts (user_id, boost_type, status, purchased_at, used_at, used_on_day, used_on_match_id)
     VALUES (?, 'double_chance', 'used', ?, ?, ?, ?)`,
    userId, Date.now(), Date.now(), DAY, matchId
  );
  const boostId = Number(ins.meta.last_row_id);
  await run(
    `INSERT INTO boost_usage (user_id, day, boost_type, boost_id, match_id, dc_variant, created_at)
     VALUES (?, ?, 'double_chance', ?, ?, '1X', ?)`,
    userId, DAY, boostId, matchId, Date.now()
  );
  return boostId;
}

beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = (proxy.env as any).DB as D1Database;
  // No TELEGRAM_BOT_TOKEN → the notification branch is skipped in tests.
  env = { DB: db };
  await createSchema();
});

afterAll(async () => {
  await proxy.dispose();
  try { rmSync(PERSIST, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(async () => {
  await resetData();
});

describe("refundBoostsForPostponedMatches", () => {
  it("refunds a double_chance stuck on a POSTPONED match", async () => {
    const boostId = await seedUsedDoubleChance("POSTPONED");

    const refunded = await refundBoostsForPostponedMatches(env, DAY);
    expect(refunded).toBe(1);

    const boost = await first(`SELECT status, used_at, used_on_day, used_on_match_id FROM user_boosts WHERE id = ?`, boostId);
    expect(boost.status).toBe("available");
    expect(boost.used_at).toBeNull();
    expect(boost.used_on_day).toBeNull();
    expect(boost.used_on_match_id).toBeNull();

    const pick = await first(`SELECT double_chance FROM picks WHERE day = ? AND match_id = ? AND user_id = ?`, DAY, MATCH, USER);
    expect(pick.double_chance).toBeNull();

    const usage = await first(`SELECT 1 AS x FROM boost_usage WHERE user_id = ? AND day = ?`, USER, DAY);
    expect(usage).toBeNull();
  });

  it("is idempotent — a second sweep finds nothing", async () => {
    await seedUsedDoubleChance("CANCELLED");
    expect(await refundBoostsForPostponedMatches(env, DAY)).toBe(1);
    expect(await refundBoostsForPostponedMatches(env, DAY)).toBe(0);
  });

  it("leaves a FINISHED match's boost untouched", async () => {
    const boostId = await seedUsedDoubleChance("FINISHED");
    expect(await refundBoostsForPostponedMatches(env, DAY)).toBe(0);
    const boost = await first(`SELECT status FROM user_boosts WHERE id = ?`, boostId);
    expect(boost.status).toBe("used");
    const pick = await first(`SELECT double_chance FROM picks WHERE day = ? AND match_id = ? AND user_id = ?`, DAY, MATCH, USER);
    expect(pick.double_chance).toBe("1X");
  });

  it("refuses today and future days (status-flap protection)", async () => {
    await seedUsedDoubleChance("POSTPONED");
    const today = new Date().toISOString().slice(0, 10);
    expect(await refundBoostsForPostponedMatches(env, today)).toBe(0);
    expect(await refundBoostsForPostponedMatches(env, "2099-01-01")).toBe(0);
    expect(await refundBoostsForPostponedMatches(env, "not-a-day")).toBe(0);
    // The past day still works afterwards.
    expect(await refundBoostsForPostponedMatches(env, DAY)).toBe(1);
  });

  it("ignores day-scoped extra_joker usage (match_id IS NULL)", async () => {
    await run(`INSERT INTO matches (day, match_id, status) VALUES (?, ?, 'POSTPONED')`, DAY, MATCH);
    const ins = await run(
      `INSERT INTO user_boosts (user_id, boost_type, status, purchased_at, used_at, used_on_day)
       VALUES (?, 'extra_joker', 'used', ?, ?, ?)`,
      USER, Date.now(), Date.now(), DAY
    );
    await run(
      `INSERT INTO boost_usage (user_id, day, boost_type, boost_id, match_id, dc_variant, created_at)
       VALUES (?, ?, 'extra_joker', ?, NULL, NULL, ?)`,
      USER, DAY, Number(ins.meta.last_row_id), Date.now()
    );
    expect(await refundBoostsForPostponedMatches(env, DAY)).toBe(0);
    const boost = await first(`SELECT status FROM user_boosts WHERE id = ?`, Number(ins.meta.last_row_id));
    expect(boost.status).toBe("used");
  });

  it("refunds several users on the same postponed match independently", async () => {
    const b1 = await seedUsedDoubleChance("POSTPONED", { userId: 7001 });
    const b2 = await seedUsedDoubleChance("POSTPONED", { userId: 7002 });
    expect(await refundBoostsForPostponedMatches(env, DAY)).toBe(2);
    for (const id of [b1, b2]) {
      const boost = await first(`SELECT status FROM user_boosts WHERE id = ?`, id);
      expect(boost.status).toBe("available");
    }
  });
});
