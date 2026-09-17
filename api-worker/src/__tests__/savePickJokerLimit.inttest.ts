// Regression test for the #2 fix: the per-day joker limit must hold. savePick now
// does the pick upsert + "trim excess jokers" cleanup in one atomic DB.batch, so
// the day never keeps more than the allowed number of jokers (1 normally, 2 with
// an extra_joker boost). Calls the real exported savePick against a local D1.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { savePick } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-joker");
const DAY = "2026-07-10";
const USER = 5501;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS matches (match_id TEXT PRIMARY KEY, day TEXT, lock_time TEXT, unlock_time TEXT, season_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS picks (day TEXT, match_id TEXT, user_id INTEGER, home INTEGER, away INTEGER, joker INTEGER DEFAULT 0, double_chance TEXT, updated_at INTEGER, season_id INTEGER, PRIMARY KEY (day, match_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, boost_type TEXT, status TEXT, purchased_at INTEGER, used_at INTEGER, used_on_day TEXT, used_on_match_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS boost_usage (user_id INTEGER, day TEXT, boost_type TEXT, boost_id INTEGER, match_id TEXT, dc_variant TEXT, created_at INTEGER, PRIMARY KEY (user_id, day))`,
  ];
  for (const s of stmts) await db.prepare(s).run();
  await db.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1)`).run();
  // Three unlocked matches with a lock_time far in the future.
  const future = "2099-01-01T00:00:00Z";
  for (const m of ["A", "B", "C"]) {
    await db.prepare(`INSERT OR REPLACE INTO matches (match_id, day, lock_time, unlock_time, season_id) VALUES (?, ?, ?, NULL, 1)`).bind(m, DAY, future).run();
  }
}

const jokerCount = async () =>
  Number(((await db.prepare(`SELECT COUNT(*) n FROM picks WHERE day=? AND user_id=? AND joker=1`).bind(DAY, USER).first()) as any)?.n ?? 0);
const jokerOn = async (matchId: string) =>
  Number(((await db.prepare(`SELECT joker FROM picks WHERE day=? AND user_id=? AND match_id=?`).bind(DAY, USER, matchId).first()) as any)?.joker ?? 0);

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

describe("#2 savePick joker limit (no extra_joker)", () => {
  it("keeps exactly one joker; a second joker moves it to the new match", async () => {
    await savePick(env as any, DAY, USER, "A", 1, 0, 1);
    expect(await jokerCount()).toBe(1);
    expect(await jokerOn("A")).toBe(1);

    await savePick(env as any, DAY, USER, "B", 2, 1, 1);
    expect(await jokerCount()).toBe(1);
    expect(await jokerOn("B")).toBe(1);
    expect(await jokerOn("A")).toBe(0);
  });
});

describe("#2 savePick joker limit (with extra_joker boost)", () => {
  it("allows two jokers, then trims to two when a third is set", async () => {
    await db.prepare(`INSERT INTO user_boosts (user_id, boost_type, status, purchased_at) VALUES (?, 'extra_joker', 'available', 0)`).bind(USER).run();

    await savePick(env as any, DAY, USER, "A", 1, 0, 1);
    await savePick(env as any, DAY, USER, "B", 2, 1, 1); // auto-applies extra_joker → 2 allowed
    expect(await jokerCount()).toBe(2);

    // Boost was consumed exactly once.
    const usedBoosts = Number(((await db.prepare(`SELECT COUNT(*) n FROM user_boosts WHERE user_id=? AND status='used'`).bind(USER).first()) as any)?.n ?? 0);
    expect(usedBoosts).toBe(1);
    const usageRows = Number(((await db.prepare(`SELECT COUNT(*) n FROM boost_usage WHERE user_id=? AND day=?`).bind(USER, DAY).first()) as any)?.n ?? 0);
    expect(usageRows).toBe(1);

    // A third joker must not exceed the cap of 2, and the newest match keeps its joker.
    await savePick(env as any, DAY, USER, "C", 0, 0, 1);
    expect(await jokerCount()).toBe(2);
    expect(await jokerOn("C")).toBe(1);
  });
});
