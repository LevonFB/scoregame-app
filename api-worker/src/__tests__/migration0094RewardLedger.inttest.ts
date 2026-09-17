// Stage 3.1 — automated migration test for 0094_reward_ledger_lucky_token.sql.
// Applies the REAL migration file (not a hand-copied SQL) against a local miniflare D1 and
// asserts: data/id preservation, sqlite_sequence/AUTOINCREMENT continuity, the widened CHECK,
// and fail-closed behavior on a dirty pre-existing reward_ledger_new.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-mig0094");
const MIGRATION_0094 = path.resolve(process.cwd(), "migrations", "0094_reward_ledger_lucky_token.sql");

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;

// Pre-0094 final schema (reward_type WITHOUT 'lucky_token'), matching the production sqlite_master dump.
const PRE_0094 = `CREATE TABLE reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task','season_prediction_task')),
  source_id TEXT, unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case')),
  amount INTEGER NOT NULL DEFAULT 0, case_type TEXT,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), granted_by INTEGER, revoked_at INTEGER, revoked_by INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}')`;

function migrationStatements(): string[] {
  const sql = readFileSync(MIGRATION_0094, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}

async function num(sql: string, ...binds: unknown[]) {
  const row = (await db.prepare(sql).bind(...binds).first()) as any;
  return Number(row?.n ?? 0);
}

async function buildPre0094WithGap() {
  await db.prepare(`DROP TABLE IF EXISTS reward_ledger`).run();
  await db.prepare(`DROP TABLE IF EXISTS reward_ledger_new`).run();
  await db.prepare(PRE_0094).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC)`).run();
  // ids with a GAP: 1, 2, 7, 15 — covering granted + revoked + every reward_type.
  const rows = [
    [1, "manual_admin", "k1", "stars", 5, null, "granted"],
    [2, "weekly_challenge_task", "k2", "balls", 3, null, "granted"],
    [7, "bracket_final_reward", "k7", "case", 1, "premium", "granted"],
    [15, "manual_admin", "k15", "stars", 9, null, "revoked"],
  ] as const;
  for (const [id, st, uk, rt, amt, ct, status] of rows) {
    await db.prepare(`INSERT INTO reward_ledger (id,user_id,source_type,source_id,unique_key,reward_type,amount,case_type,status,granted_at,granted_by,revoked_at,revoked_by,metadata_json) VALUES (?,1,?, 's', ?, ?, ?, ?, ?, 1000, ?, ?, ?, '{"m":1}')`)
      .bind(id, st, uk, rt, amt, ct, status, status === "revoked" ? 77 : null, status === "revoked" ? 2000 : null, status === "revoked" ? 77 : null)
      .run();
  }
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(buildPre0094WithGap);

describe("migration 0094 — data + AUTOINCREMENT preservation", () => {
  it("preserves rows/ids/status/metadata, restores indexes, and widens the reward_type CHECK", async () => {
    const beforeMax = await num(`SELECT MAX(id) n FROM reward_ledger`);
    const beforeSeq = await num(`SELECT seq n FROM sqlite_sequence WHERE name='reward_ledger'`);
    expect(beforeMax).toBe(15);
    expect(beforeSeq).toBe(15);

    for (const stmt of migrationStatements()) await db.prepare(stmt).run();

    expect(await num(`SELECT COUNT(*) n FROM reward_ledger`)).toBe(4);
    const ids = await db.prepare(`SELECT group_concat(id) g FROM reward_ledger ORDER BY id`).first() as any;
    expect(String(ids.g)).toBe("1,2,7,15");
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE status='granted'`)).toBe(3);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE status='revoked'`)).toBe(1);
    // revoked row preserved exactly.
    const rev = await db.prepare(`SELECT revoked_at, revoked_by, metadata_json FROM reward_ledger WHERE unique_key='k15'`).first() as any;
    expect(rev).toMatchObject({ revoked_at: 2000, revoked_by: 77, metadata_json: '{"m":1}' });
    // indexes restored (UNIQUE autoindex + named index).
    const idx = await db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND tbl_name='reward_ledger'`).first() as any;
    expect(Number(idx.n)).toBeGreaterThanOrEqual(2);
    // sqlite_sequence preserved; next auto id = 16.
    expect(await num(`SELECT seq n FROM sqlite_sequence WHERE name='reward_ledger'`)).toBe(15);
    await db.prepare(`INSERT INTO reward_ledger (user_id,source_type,source_id,unique_key,reward_type,amount,status,granted_at) VALUES (2,'manual_admin','s','k_auto','lucky_token',1,'granted',1)`).run();
    expect(await num(`SELECT id n FROM reward_ledger WHERE unique_key='k_auto'`)).toBe(16);
  });

  it("post-migration CHECK accepts lucky_token + legacy types and rejects unknown; UNIQUE still enforced", async () => {
    for (const stmt of migrationStatements()) await db.prepare(stmt).run();
    // lucky_token accepted.
    await db.prepare(`INSERT INTO reward_ledger (user_id,source_type,source_id,unique_key,reward_type,amount,status,granted_at) VALUES (1,'season_prediction_task','s','lt1','lucky_token',2,'granted',1)`).run();
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE reward_type='lucky_token'`)).toBe(1);
    // unknown rejected.
    await expect(db.prepare(`INSERT INTO reward_ledger (user_id,source_type,source_id,unique_key,reward_type,amount,status,granted_at) VALUES (1,'manual_admin','s','bad','gold',1,'granted',1)`).run())
      .rejects.toThrow(/CHECK constraint failed/);
    // unknown source_type still rejected.
    await expect(db.prepare(`INSERT INTO reward_ledger (user_id,source_type,source_id,unique_key,reward_type,amount,status,granted_at) VALUES (1,'hacky','s','bad2','stars',1,'granted',1)`).run())
      .rejects.toThrow(/CHECK constraint failed/);
    // UNIQUE(unique_key) still enforced.
    await expect(db.prepare(`INSERT INTO reward_ledger (user_id,source_type,source_id,unique_key,reward_type,amount,status,granted_at) VALUES (1,'manual_admin','s','lt1','stars',1,'granted',1)`).run())
      .rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("migration 0094 — fail-closed on dirty state", () => {
  it("errors on CREATE TABLE when reward_ledger_new already exists; live table + data untouched, DROP not reached", async () => {
    // Simulate a leftover from an interrupted run.
    await db.prepare(`CREATE TABLE reward_ledger_new (id INTEGER PRIMARY KEY, junk TEXT)`).run();
    await db.prepare(`INSERT INTO reward_ledger_new (id, junk) VALUES (999, 'leftover')`).run();

    const stmts = migrationStatements();
    // The migrator runs statements sequentially and stops at the first error. We mirror that:
    // the first statement (CREATE TABLE reward_ledger_new) must throw.
    let failedAtFirst = false;
    try {
      await db.prepare(stmts[0]).run();
    } catch {
      failedAtFirst = true;
    }
    expect(failedAtFirst).toBe(true);

    // Live reward_ledger and its rows are intact; the stray table is untouched.
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger`)).toBe(4);
    expect(await num(`SELECT COUNT(*) n FROM reward_ledger WHERE unique_key='k1'`)).toBe(1);
    const stray = await db.prepare(`SELECT junk FROM reward_ledger_new WHERE id=999`).first() as any;
    expect(stray.junk).toBe("leftover");
    // Old CHECK still in place — DROP/RENAME never executed.
    const sql = await db.prepare(`SELECT sql FROM sqlite_master WHERE name='reward_ledger' AND type='table'`).first() as any;
    expect(String(sql.sql)).toContain("CHECK (reward_type IN ('stars','balls','case'))");
    expect(String(sql.sql)).not.toContain("lucky_token");

    await db.prepare(`DROP TABLE reward_ledger_new`).run(); // cleanup for next test
  });
});
