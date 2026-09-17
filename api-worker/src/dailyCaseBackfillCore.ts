// Stage 3.1 — testable orchestration core for daily-case backfill V2.
//
// Production index.ts delegates to runBackfillCore() and NEVER passes a `fault`
// hook, so there is no failure-injection path in the production runtime. Tests
// drive this module directly (via getPlatformProxy's local D1) and inject faults
// through the `deps.fault` argument — dependency injection (Variant A).

import { buildJobKey, isValidMatchdayKey } from "./dailyCaseBackfillV2";
import { logEvent, makeRunId } from "./obs";

export interface BackfillRunResult {
  ok: boolean;
  claimed?: boolean;
  decision?: string;
  status?: string;
  processed_eligible_users?: number;
  eligible_users?: number;
  restored_cases?: number;
  skipped_existing_cases?: number;
  failed_items?: number;
  error?: string;
}

export interface BackfillJobRowFull {
  job_key: string;
  matchday_key: string;
  status: string;
  run_id?: string | null;
  heartbeat_at?: number | null;
  [k: string]: any;
}

export async function getBackfillJob(db: D1Database, jobKey: string): Promise<BackfillJobRowFull | null> {
  try {
    const row = await db.prepare(`SELECT * FROM daily_case_backfill_jobs WHERE job_key = ?`).bind(jobKey).first() as any;
    return row || null;
  } catch {
    // Table absent (V2 not migrated) → behave as "no job".
    return null;
  }
}

/**
 * Atomic, idempotent per-case grant in ONE D1 batch (D1 batches are transactional
 * — verified: a failing statement rolls back the whole batch). The marker
 * (earned=2 AND earned_at=nowMs) ties the inventory + ledger writes to the exact
 * CAS that promoted the case in THIS call, so:
 *   - if the case was already earned=2 → nothing happens (no double grant);
 *   - inventory and ledger can never diverge (same batch);
 *   - a crash either commits all three writes or none.
 */
export async function atomicDailyCaseTransfer(
  db: D1Database,
  userId: number,
  matchday: string,
  nowMs: number,
  comment = "daily_case_backfill_v2"
): Promise<{ restored: boolean }> {
  const results = await db.batch([
    // 1) compare-and-set: promote earned 1→2, or create earned=2 if missing.
    db.prepare(
      `INSERT INTO daily_cases (user_id, day, earned, earned_at) VALUES (?1, ?2, 2, ?3)
       ON CONFLICT(user_id, day) DO UPDATE SET earned = 2, earned_at = ?3 WHERE daily_cases.earned = 1`
    ).bind(userId, matchday, nowMs),
    // 2) inventory +1, guarded by the marker so it only applies when WE promoted now.
    db.prepare(
      `INSERT INTO user_cases (user_id, case_type, quantity)
       SELECT ?1, 'daily_free', 1
       WHERE EXISTS (SELECT 1 FROM daily_cases WHERE user_id = ?1 AND day = ?2 AND earned = 2 AND earned_at = ?3)
       ON CONFLICT(user_id, case_type) DO UPDATE SET quantity = quantity + 1`
    ).bind(userId, matchday, nowMs),
    // 3) ledger row, guarded by the same marker; before/after read post-increment.
    db.prepare(
      `INSERT INTO case_transactions (user_id, case_type, amount, quantity_before, quantity_after, operation_type, comment, created_at)
       SELECT ?1, 'daily_free', 1,
         (SELECT COALESCE(quantity,0) FROM user_cases WHERE user_id = ?1 AND case_type = 'daily_free') - 1,
         (SELECT COALESCE(quantity,0) FROM user_cases WHERE user_id = ?1 AND case_type = 'daily_free'),
         'earn', ?4, ?3
       WHERE EXISTS (SELECT 1 FROM daily_cases WHERE user_id = ?1 AND day = ?2 AND earned = 2 AND earned_at = ?3)`
    ).bind(userId, matchday, nowMs, comment),
  ]);
  const promoted = (results?.[0]?.meta?.changes ?? 0) > 0;
  return { restored: promoted };
}

// Atomic single-owner claim via unique job_key + compare-and-set on status.
export async function claimBackfillJob(
  db: D1Database,
  jobKey: string,
  matchday: string,
  runId: string,
  nowMs: number,
  staleMs: number
): Promise<{ claimed: boolean; decision: string }> {
  const staleThreshold = nowMs - staleMs;
  const res = await db.prepare(`
    INSERT INTO daily_case_backfill_jobs
      (job_key, matchday_key, status, run_id, attempts, started_at, heartbeat_at, dry_run, created_at, updated_at)
    VALUES (?, ?, 'running', ?, 1, ?, ?, 0, ?, ?)
    ON CONFLICT(job_key) DO UPDATE SET
      status='running', run_id=excluded.run_id, attempts=daily_case_backfill_jobs.attempts+1,
      started_at=excluded.started_at, heartbeat_at=excluded.heartbeat_at, updated_at=excluded.updated_at,
      failed_at=NULL, last_error_code=NULL, cursor_user_id=0
    WHERE daily_case_backfill_jobs.status IN ('pending','failed','dry_run_completed')
       OR (daily_case_backfill_jobs.status='running' AND COALESCE(daily_case_backfill_jobs.heartbeat_at,0) < ?)
  `).bind(jobKey, matchday, runId, nowMs, nowMs, nowMs, nowMs, staleThreshold).run();
  const changes = res.meta?.changes ?? 0;
  if (changes > 0) {
    const row = await getBackfillJob(db, jobKey);
    if (row && String(row.run_id) === runId) return { claimed: true, decision: "claimed" };
    return { claimed: false, decision: "lost_race" };
  }
  const row = await getBackfillJob(db, jobKey);
  return { claimed: false, decision: row?.status === "completed" ? "already_completed" : "already_running" };
}

export interface BackfillParams {
  batchSize: number;
  maxBatches: number;
  staleLockMs: number;
}

export type FaultPhase = "before_transfer" | "after_transfer" | "after_heartbeat";

export interface BackfillCoreDeps {
  trigger: string;
  listEligible: (afterUserId: number, limit: number) => Promise<number[]>;
  // TEST-ONLY (never passed by production). DI hook to simulate a crash.
  fault?: (phase: FaultPhase, ctx: { userId?: number; restored: number }) => void | Promise<void>;
  transfer?: (userId: number, matchday: string, nowMs: number) => Promise<{ restored: boolean }>;
  now?: () => number;
  runId?: string;
}

/** Apply run: claims the job, restores eligible cases atomically in batches. */
export async function runBackfillCore(
  db: D1Database,
  matchday: string,
  params: BackfillParams,
  deps: BackfillCoreDeps
): Promise<BackfillRunResult> {
  const t0 = Date.now();
  const now = deps.now ?? (() => Date.now());
  const runId = deps.runId ?? makeRunId();
  const jobKey = buildJobKey(matchday);
  const transfer = deps.transfer ?? ((uid: number, md: string, n: number) => atomicDailyCaseTransfer(db, uid, md, n));

  if (!isValidMatchdayKey(matchday)) {
    logEvent({ operation: "daily_case_backfill_v2", trigger: deps.trigger, run_id: runId, job_key: jobKey, matchday_key: String(matchday).slice(0, 10), status: "error", reason_code: "invalid_matchday" });
    return { ok: false, error: "INVALID_MATCHDAY" };
  }

  let claim: { claimed: boolean; decision: string };
  try {
    claim = await claimBackfillJob(db, jobKey, matchday, runId, now(), params.staleLockMs);
  } catch (e: any) {
    // V2 enabled but the job table is missing → controlled error, NOT completed.
    logEvent({ operation: "daily_case_backfill_v2", trigger: deps.trigger, run_id: runId, job_key: jobKey, matchday_key: matchday, status: "error", reason_code: "job_table_unavailable", error_code: String(e?.message || e).slice(0, 40), duration_ms: Date.now() - t0 });
    return { ok: false, error: "JOB_TABLE_UNAVAILABLE" };
  }
  if (!claim.claimed) {
    logEvent({ operation: "daily_case_backfill_v2", trigger: deps.trigger, run_id: runId, job_key: jobKey, matchday_key: matchday, status: "skipped", reason_code: claim.decision, lock_result: claim.decision, duration_ms: Date.now() - t0 });
    return { ok: true, claimed: false, decision: claim.decision };
  }

  let processed = 0, restored = 0, skippedExisting = 0, failed = 0, cursor = 0, batches = 0;
  let lastError = "";
  let status = "completed";
  try {
    while (batches < params.maxBatches) {
      const users = await deps.listEligible(cursor, params.batchSize);
      if (!users.length) break;
      batches++;
      for (const uid of users) {
        if (deps.fault) await deps.fault("before_transfer", { userId: uid, restored });
        processed++;
        cursor = uid;
        const res = await transfer(uid, matchday, now());
        if (res.restored) restored++; else skippedExisting++;
        if (deps.fault) await deps.fault("after_transfer", { userId: uid, restored });
      }
      const upd = await db.prepare(`
        UPDATE daily_case_backfill_jobs
        SET heartbeat_at=?, cursor_user_id=?, processed_eligible_users=?, eligible_users=?, restored_cases=?, skipped_existing_cases=?, failed_items=?, updated_at=?
        WHERE job_key=? AND run_id=?
      `).bind(now(), cursor, processed, processed, restored, skippedExisting, failed, now(), jobKey, runId).run();
      if ((upd.meta?.changes ?? 0) === 0) { status = "lost_lock"; break; }
      if (deps.fault) await deps.fault("after_heartbeat", { restored });
      if (users.length < params.batchSize) break;
    }
  } catch (e: any) {
    status = "failed";
    failed++;
    lastError = String(e?.message || e).slice(0, 40);
  }

  const fin = now();
  if (status === "completed") {
    await db.prepare(`UPDATE daily_case_backfill_jobs SET status='completed', completed_at=?, heartbeat_at=?, processed_eligible_users=?, eligible_users=?, restored_cases=?, skipped_existing_cases=?, failed_items=?, cursor_user_id=?, updated_at=? WHERE job_key=? AND run_id=?`)
      .bind(fin, fin, processed, processed, restored, skippedExisting, failed, cursor, fin, jobKey, runId).run();
  } else if (status === "failed") {
    await db.prepare(`UPDATE daily_case_backfill_jobs SET status='failed', failed_at=?, last_error_code=?, heartbeat_at=?, processed_eligible_users=?, eligible_users=?, restored_cases=?, skipped_existing_cases=?, failed_items=?, cursor_user_id=?, updated_at=? WHERE job_key=? AND run_id=?`)
      .bind(fin, lastError, fin, processed, processed, restored, skippedExisting, failed, cursor, fin, jobKey, runId).run();
  }

  logEvent({ operation: "daily_case_backfill_v2", trigger: deps.trigger, run_id: runId, job_key: jobKey, matchday_key: matchday, status, dry_run: false, duration_ms: fin - t0, processed_eligible_users: processed, eligible_users: processed, restored_cases: restored, skipped_existing_cases: skippedExisting, failed_items: failed, reason_code: status, lock_result: "claimed" });
  return { ok: status === "completed", status, processed_eligible_users: processed, eligible_users: processed, restored_cases: restored, skipped_existing_cases: skippedExisting, failed_items: failed };
}
