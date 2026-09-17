import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import {
  atomicDailyCaseTransfer,
  getBackfillJob,
  runBackfillCore,
  type BackfillCoreDeps,
} from "../dailyCaseBackfillCore";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int");
const MATCHDAY = "2026-05-01";
const PARAMS = { batchSize: 100, maxBatches: 10, staleLockMs: 60_000 };

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS daily_cases (user_id INTEGER, day TEXT, earned INTEGER DEFAULT 0, earned_at INTEGER, PRIMARY KEY(user_id,day))`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id,case_type))`,
    `CREATE TABLE IF NOT EXISTS case_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, case_type TEXT, amount INTEGER, quantity_before INTEGER, quantity_after INTEGER, operation_type TEXT, comment TEXT, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS daily_case_backfill_jobs (job_key TEXT PRIMARY KEY, matchday_key TEXT, status TEXT DEFAULT 'pending', run_id TEXT, attempts INTEGER DEFAULT 0, started_at INTEGER, heartbeat_at INTEGER, completed_at INTEGER, failed_at INTEGER, last_error_code TEXT, processed_eligible_users INTEGER DEFAULT 0, eligible_users INTEGER DEFAULT 0, restored_cases INTEGER DEFAULT 0, skipped_existing_cases INTEGER DEFAULT 0, failed_items INTEGER DEFAULT 0, cursor_user_id INTEGER DEFAULT 0, dry_run INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  ];
  for (const s of stmts) await db.prepare(s).run();
}
async function resetData() {
  for (const t of ["daily_cases", "user_cases", "case_transactions", "daily_case_backfill_jobs"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}
const qty = async (uid: number) => Number((await db.prepare(`SELECT COALESCE(quantity,0) q FROM user_cases WHERE user_id=? AND case_type='daily_free'`).bind(uid).first() as any)?.q ?? 0);
const ledger = async (uid: number) => Number((await db.prepare(`SELECT COUNT(*) n FROM case_transactions WHERE user_id=? AND comment='daily_case_backfill_v2'`).bind(uid).first() as any)?.n ?? 0);
const earned = async (uid: number) => Number((await db.prepare(`SELECT COALESCE(earned,-1) e FROM daily_cases WHERE user_id=? AND day=?`).bind(uid, MATCHDAY).first() as any)?.e ?? -1);
const jobStatus = async () => (await getBackfillJob(db, `daily-case-backfill:${MATCHDAY}`))?.status ?? null;

// Keyset-style eligible list over a fixed set.
function eligibleFrom(ids: number[]): BackfillCoreDeps["listEligible"] {
  return async (after: number, limit: number) => ids.filter((i) => i > after).slice(0, limit);
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  await createSchema();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(resetData);

describe("atomicDailyCaseTransfer", () => {
  it("grants exactly once: case + ledger + earned=2, idempotent on repeat", async () => {
    const r1 = await atomicDailyCaseTransfer(db, 1, MATCHDAY, Date.now());
    expect(r1.restored).toBe(true);
    expect(await qty(1)).toBe(1);
    expect(await ledger(1)).toBe(1);
    expect(await earned(1)).toBe(2);

    const r2 = await atomicDailyCaseTransfer(db, 1, MATCHDAY, Date.now() + 5);
    expect(r2.restored).toBe(false);
    expect(await qty(1)).toBe(1);
    expect(await ledger(1)).toBe(1);
  });

  it("inventory and ledger never diverge (single atomic batch)", async () => {
    await atomicDailyCaseTransfer(db, 2, MATCHDAY, Date.now());
    const q = await qty(2);
    const l = await ledger(2);
    expect(q).toBe(1);
    expect(l).toBe(1); // exactly one earn ledger for the grant
  });

  it("does not grant when daily_cases.earned=0 (not eligible state)", async () => {
    await db.prepare(`INSERT INTO daily_cases (user_id,day,earned) VALUES (3,?,0)`).bind(MATCHDAY).run();
    const r = await atomicDailyCaseTransfer(db, 3, MATCHDAY, Date.now());
    expect(r.restored).toBe(false);
    expect(await qty(3)).toBe(0);
  });
});

describe("runBackfillCore — happy path + counters", () => {
  it("restores all eligible once; reports processed_eligible_users (not checked_users)", async () => {
    const res = await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([10, 11, 12]) });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("completed");
    expect(res.restored_cases).toBe(3);
    expect(res.processed_eligible_users).toBe(3);
    expect((res as any).checked_users).toBeUndefined();
    for (const uid of [10, 11, 12]) {
      expect(await qty(uid)).toBe(1);
      expect(await ledger(uid)).toBe(1);
    }
    expect(await jobStatus()).toBe("completed");
  });
});

describe("runBackfillCore — failure points (DI fault hook, test-only)", () => {
  it("failure BEFORE first transfer leaves nothing; retry grants once", async () => {
    const faulty: BackfillCoreDeps = {
      trigger: "test",
      listEligible: eligibleFrom([20, 21]),
      fault: (phase) => { if (phase === "before_transfer") throw new Error("boom-before"); },
    };
    const r1 = await runBackfillCore(db, MATCHDAY, PARAMS, faulty);
    expect(r1.status).toBe("failed");
    expect(await qty(20)).toBe(0);
    expect(await qty(21)).toBe(0);
    expect(await jobStatus()).toBe("failed");

    // Retry without fault → both granted exactly once.
    const r2 = await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([20, 21]) });
    expect(r2.status).toBe("completed");
    for (const uid of [20, 21]) { expect(await qty(uid)).toBe(1); expect(await ledger(uid)).toBe(1); }
  });

  it("failure AFTER first transfer keeps that grant; retry skips it (no duplicate)", async () => {
    let count = 0;
    const faulty: BackfillCoreDeps = {
      trigger: "test",
      listEligible: eligibleFrom([30, 31]),
      fault: (phase) => { if (phase === "after_transfer") { count++; if (count === 1) throw new Error("boom-after"); } },
    };
    const r1 = await runBackfillCore(db, MATCHDAY, PARAMS, faulty);
    expect(r1.status).toBe("failed");
    expect(await qty(30)).toBe(1); // first grant committed atomically before fault
    expect(await ledger(30)).toBe(1);

    const r2 = await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([30, 31]) });
    expect(r2.status).toBe("completed");
    expect(await qty(30)).toBe(1); // not duplicated
    expect(await ledger(30)).toBe(1);
    expect(await qty(31)).toBe(1);
  });
});

describe("invariant: earned=2 ⇒ exactly one identifiable earn-ledger", () => {
  it("holds after a correct grant", async () => {
    await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([40]) });
    expect(await earned(40)).toBe(2);
    expect(await ledger(40)).toBe(1);
  });

  it("repeated runs do not add a second ledger", async () => {
    await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([41]) });
    await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([41]) });
    expect(await ledger(41)).toBe(1);
    expect(await qty(41)).toBe(1);
  });
});

describe("V2 enabled but job table missing → controlled error", () => {
  it("returns JOB_TABLE_UNAVAILABLE and does not mark completed", async () => {
    await db.prepare(`DROP TABLE IF EXISTS daily_case_backfill_jobs`).run();
    try {
      const res = await runBackfillCore(db, MATCHDAY, PARAMS, { trigger: "test", listEligible: eligibleFrom([50]) });
      expect(res.ok).toBe(false);
      expect(res.error).toBe("JOB_TABLE_UNAVAILABLE");
      // No grant happened, no completed status (table doesn't exist anyway).
      expect(await qty(50)).toBe(0);
    } finally {
      await createSchema(); // restore for subsequent files/tests
    }
  });
});
