// Regression test for the #5 fix: resetting a day's picks must return any boost
// applied that day to 'available' and clear its boost_usage row, instead of
// silently burning the boost and leaving an orphaned usage row that keeps
// blocking the "1 paid boost/day" rule. Calls the real exported resetUserPicks.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { resetUserPicks } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-reset");
const DAY = "2026-07-10";
const USER = 6601;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS picks (day TEXT, match_id TEXT, user_id INTEGER, home INTEGER, away INTEGER, joker INTEGER DEFAULT 0, double_chance TEXT, updated_at INTEGER, PRIMARY KEY (day, match_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, boost_type TEXT, status TEXT, purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS boost_usage (user_id INTEGER, day TEXT, boost_type TEXT, boost_id INTEGER, match_id TEXT, dc_variant TEXT, created_at INTEGER, PRIMARY KEY (user_id, day))`,
  ];
  for (const s of stmts) await db.prepare(s).run();
}

const n = async (sql: string, ...b: unknown[]) => Number(((await db.prepare(sql).bind(...b).first()) as any)?.n ?? 0);

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
beforeEach(async () => {
  for (const t of ["picks", "user_boosts", "boost_usage"]) await db.prepare(`DELETE FROM ${t}`).run();
});

describe("#5 resetUserPicks returns applied boosts", () => {
  it("clears picks, restores the boost to available, and removes the usage row", async () => {
    await db.prepare(`INSERT INTO user_boosts (id, user_id, boost_type, status, purchased_at, used_at, used_on_day, used_on_match_id) VALUES (1, ?, 'double_chance', 'used', 0, 123, ?, 'A')`).bind(USER, DAY).run();
    await db.prepare(`INSERT INTO boost_usage (user_id, day, boost_type, boost_id, match_id, dc_variant, created_at) VALUES (?, ?, 'double_chance', 1, 'A', '1X', 123)`).bind(USER, DAY).run();
    await db.prepare(`INSERT INTO picks (day, match_id, user_id, home, away, joker, double_chance, updated_at) VALUES (?, 'A', ?, 1, 0, 0, '1X', 123)`).bind(DAY, USER).run();

    await resetUserPicks(env as any, DAY, USER);

    expect(await n(`SELECT COUNT(*) n FROM picks WHERE day=? AND user_id=?`, DAY, USER)).toBe(0);
    expect(await n(`SELECT COUNT(*) n FROM boost_usage WHERE user_id=? AND day=?`, USER, DAY)).toBe(0);

    const boost = (await db.prepare(`SELECT status, used_at, used_on_day, used_on_match_id FROM user_boosts WHERE id=1`).first()) as any;
    expect(boost.status).toBe("available");
    expect(boost.used_at).toBeNull();
    expect(boost.used_on_day).toBeNull();
    expect(boost.used_on_match_id).toBeNull();
  });

  it("is a no-op for a day with no applied boost", async () => {
    await db.prepare(`INSERT INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES (?, 'A', ?, 1, 0, 0, 123)`).bind(DAY, USER).run();
    await resetUserPicks(env as any, DAY, USER);
    expect(await n(`SELECT COUNT(*) n FROM picks WHERE day=? AND user_id=?`, DAY, USER)).toBe(0);
  });
});
