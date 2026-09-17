import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { runWeeklyFinalizerCore, getWeeklyJob, type WeeklyScopeRef } from "../weeklyFinalizerCore";
import { buildWeeklyJobKey } from "../weeklyFinalizerV2";
import { previousWeeklyScope, weeklyGetShouldRunLegacy } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-wf");
const SCOPE: WeeklyScopeRef = { seasonId: 1, weekKey: "2026-W20" };
const JOB_KEY = buildWeeklyJobKey(SCOPE.seasonId, SCOPE.weekKey);
const PARAMS = { maxPeriods: 10, staleLockMs: 60_000 };
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;

async function schema() {
  await db.prepare(`CREATE TABLE IF NOT EXISTS weekly_finalizer_jobs (job_key TEXT PRIMARY KEY, season_id INTEGER, week_key TEXT, status TEXT DEFAULT 'pending', run_id TEXT, attempts INTEGER DEFAULT 0, started_at INTEGER, heartbeat_at INTEGER, completed_at INTEGER, failed_at INTEGER, last_error_code TEXT, finalized_periods INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`).run();
}
const jobStatus = async () => (await getWeeklyJob(db, JOB_KEY))?.status ?? null;
const runId = async () => (await getWeeklyJob(db, JOB_KEY))?.run_id ?? null;

// finalize spy
function makeDeps(extra: any = {}) {
  const calls: WeeklyScopeRef[] = [];
  const deps = {
    trigger: "test",
    listReadyScopes: async () => [SCOPE],
    finalizeScope: async (s: WeeklyScopeRef) => { calls.push(s); return { ok: true }; },
    ...extra,
  };
  return { deps, calls };
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  await schema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(async () => { await db.prepare(`DELETE FROM weekly_finalizer_jobs`).run(); });

describe("weekly finalizer core", () => {
  it("first run claims + finalizes once; job completed", async () => {
    const { deps, calls } = makeDeps();
    const r = await runWeeklyFinalizerCore(db, PARAMS, deps);
    expect(r.finalized_periods).toBe(1);
    expect(calls.length).toBe(1);
    expect(await jobStatus()).toBe("completed");
  });

  it("repeat run does not re-finalize a completed period", async () => {
    const { deps, calls } = makeDeps();
    await runWeeklyFinalizerCore(db, PARAMS, deps);
    const r2 = await runWeeklyFinalizerCore(db, PARAMS, deps);
    expect(r2.skipped_locked).toBe(1);
    expect(calls.length).toBe(1); // not called again
  });

  it("two concurrent runs finalize exactly once", async () => {
    const { deps, calls } = makeDeps();
    await Promise.all([runWeeklyFinalizerCore(db, PARAMS, deps), runWeeklyFinalizerCore(db, PARAMS, deps)]);
    expect(calls.length).toBe(1);
    expect(await jobStatus()).toBe("completed");
  });

  it("failure (before_finalize) → failed; retry completes; no double finalize", async () => {
    const { deps, calls } = makeDeps({ fault: (phase: string) => { if (phase === "before_finalize") throw new Error("boom"); } });
    const r1 = await runWeeklyFinalizerCore(db, PARAMS, deps);
    expect(r1.failed_periods).toBe(1);
    expect(await jobStatus()).toBe("failed");
    expect(calls.length).toBe(0);
    const { deps: deps2, calls: calls2 } = makeDeps();
    const r2 = await runWeeklyFinalizerCore(db, PARAMS, deps2);
    expect(r2.finalized_periods).toBe(1);
    expect(calls2.length).toBe(1);
    expect(await jobStatus()).toBe("completed");
  });

  it("stale running job is taken over with a new run_id", async () => {
    await db.prepare(`INSERT INTO weekly_finalizer_jobs (job_key, season_id, week_key, status, run_id, heartbeat_at, created_at, updated_at) VALUES (?, 1, '2026-W20', 'running', 'OLD', 1, 1, 1)`).bind(JOB_KEY).run();
    const { deps, calls } = makeDeps();
    await runWeeklyFinalizerCore(db, { ...PARAMS, staleLockMs: 1000 }, deps);
    expect(calls.length).toBe(1);
    expect(await jobStatus()).toBe("completed");
    expect(await runId()).not.toBe("OLD");
  });

  it("fresh running job (not stale) is left alone", async () => {
    await db.prepare(`INSERT INTO weekly_finalizer_jobs (job_key, season_id, week_key, status, run_id, heartbeat_at, created_at, updated_at) VALUES (?, 1, '2026-W20', 'running', 'CUR', ?, 1, 1)`).bind(JOB_KEY, Date.now()).run();
    const { deps, calls } = makeDeps();
    const r = await runWeeklyFinalizerCore(db, PARAMS, deps);
    expect(r.skipped_locked).toBe(1);
    expect(calls.length).toBe(0);
    expect(await runId()).toBe("CUR");
  });

  it("job table missing → controlled error, no crash", async () => {
    await db.prepare(`DROP TABLE IF EXISTS weekly_finalizer_jobs`).run();
    const { deps, calls } = makeDeps();
    const r = await runWeeklyFinalizerCore(db, PARAMS, deps);
    expect(r.failed_periods).toBe(1);
    expect(calls.length).toBe(0);
    await schema();
  });
});

describe("GET /quests/weekly gate (weeklyGetShouldRunLegacy)", () => {
  const current: WeeklyScopeRef = { seasonId: 1, weekKey: "current" };
  const targetKey = () => buildWeeklyJobKey(previousWeeklyScope(current).seasonId, previousWeeklyScope(current).weekKey);
  const envOf = (vars: Record<string, string>) => ({ DB: db, WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_ENABLED: "true", ...vars }) as any;
  const seedJob = async (status: string, hb = Date.now()) => {
    const p = previousWeeklyScope(current);
    await db.prepare(`INSERT OR REPLACE INTO weekly_finalizer_jobs (job_key, season_id, week_key, status, run_id, heartbeat_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'R', ?, 1, 1)`).bind(targetKey(), p.seasonId, p.weekKey, status, hb).run();
  };

  it("V2 off → always run legacy", async () => {
    expect(await weeklyGetShouldRunLegacy(envOf({ WEEKLY_FINALIZER_V2_ENABLED: "false" }), current)).toBe(true);
  });
  it("completed job → skip legacy", async () => {
    await seedJob("completed");
    expect(await weeklyGetShouldRunLegacy(envOf({}), current)).toBe(false);
  });
  it("fresh running job → skip legacy", async () => {
    await seedJob("running", Date.now());
    expect(await weeklyGetShouldRunLegacy(envOf({}), current)).toBe(false);
  });
  it("failed job + fallback on → run legacy fallback", async () => {
    await seedJob("failed");
    expect(await weeklyGetShouldRunLegacy(envOf({}), current)).toBe(true);
  });
  it("missing job + fallback off → skip (no finalize)", async () => {
    await db.prepare(`DELETE FROM weekly_finalizer_jobs`).run();
    expect(await weeklyGetShouldRunLegacy(envOf({ WEEKLY_GET_FALLBACK_ENABLED: "false" }), current)).toBe(false);
  });

  // ── Stage 7: per-user allowlist read-skip (3rd arg = userId) ──
  // NOTE: build env via envOf() INSIDE each it() — db is only set in beforeAll.
  const allow = () => envOf({ WEEKLY_GET_FALLBACK_SKIP_USER_IDS: "555" });

  it("allowlist + completed → skip legacy (read only)", async () => {
    await seedJob("completed");
    expect(await weeklyGetShouldRunLegacy(allow(), current, 555)).toBe(false);
  });
  it("allowlist + fresh running → skip legacy", async () => {
    await seedJob("running", Date.now());
    expect(await weeklyGetShouldRunLegacy(allow(), current, 555)).toBe(false);
  });
  it("allowlist + failed → does NOT run legacy (Stage 7), unlike non-allowlist", async () => {
    await seedJob("failed");
    expect(await weeklyGetShouldRunLegacy(allow(), current, 555)).toBe(false); // allowlisted: pure read
    expect(await weeklyGetShouldRunLegacy(allow(), current, 999)).toBe(true);  // non-allowlist: legacy fallback
  });
  it("allowlist + missing job → 0 finalize (skip)", async () => {
    await db.prepare(`DELETE FROM weekly_finalizer_jobs`).run();
    expect(await weeklyGetShouldRunLegacy(allow(), current, 555)).toBe(false);
  });
  it("removing user from allowlist immediately restores legacy fallback", async () => {
    await seedJob("failed");
    const noAllow = envOf({ WEEKLY_GET_FALLBACK_SKIP_USER_IDS: "" });
    expect(await weeklyGetShouldRunLegacy(noAllow, current, 555)).toBe(true);
  });
  it("V2 off → allowlist ignored, legacy runs", async () => {
    await seedJob("completed");
    const off = envOf({ WEEKLY_FINALIZER_V2_ENABLED: "false", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: "555" });
    expect(await weeklyGetShouldRunLegacy(off, current, 555)).toBe(true);
  });
  it("fail-safe: job-status read error + allowlist → safe legacy fallback (no false completed)", async () => {
    await db.prepare(`DROP TABLE IF EXISTS weekly_finalizer_jobs`).run();
    try {
      expect(await weeklyGetShouldRunLegacy(allow(), current, 555)).toBe(true);
    } finally {
      await schema();
    }
  });
  it("fail-safe: job-status read error + non-allowlist → propagates (Stage 6, no finalize)", async () => {
    await db.prepare(`DROP TABLE IF EXISTS weekly_finalizer_jobs`).run();
    try {
      await expect(weeklyGetShouldRunLegacy(allow(), current, 999)).rejects.toThrow();
    } finally {
      await schema();
    }
  });
});
