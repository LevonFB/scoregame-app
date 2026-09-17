// Stage 6 — testable orchestration for weekly finalizer V2. Production passes the
// real `finalizeScope` (existing finalizeWeeklyPeriod) and NO fault hook. Tests
// drive this with a local D1 + injected finalize/fault (dependency injection).

import { claimJob, getJob } from "./jobLock";
import { buildWeeklyJobKey, WEEKLY_FINALIZER_TABLE, type WeeklyParams } from "./weeklyFinalizerV2";
import { logEvent, makeRunId } from "./obs";

export interface WeeklyScopeRef { seasonId: number; weekKey: string }

export interface WeeklyFinalizerDeps {
  trigger: string;
  listReadyScopes: () => Promise<WeeklyScopeRef[]>;
  finalizeScope: (scope: WeeklyScopeRef) => Promise<{ ok: boolean; reason?: string | null }>;
  fault?: (phase: "before_finalize" | "after_finalize", ctx: { scope: WeeklyScopeRef }) => void | Promise<void>;
  now?: () => number;
  runId?: string;
}

export interface WeeklyFinalizerResult {
  ok: boolean;
  status: string;
  processed_periods: number;
  finalized_periods: number;
  skipped_locked: number;
  failed_periods: number;
  error?: string;
}

export async function getWeeklyJob(db: D1Database, jobKey: string) {
  return getJob(db, WEEKLY_FINALIZER_TABLE, jobKey);
}

// Stage 7 — strict reader that DOES surface a genuine read failure (it does not
// swallow errors like getJob). Used only by the GET gate when V2 is enabled, so a
// real D1 read error / absent table maps to the fail-safe path instead of silently
// looking like "no job". Returns null only for a successful "no row" result.
export async function getWeeklyJobStrict(db: D1Database, jobKey: string) {
  const row = (await db.prepare(`SELECT * FROM ${WEEKLY_FINALIZER_TABLE} WHERE job_key = ?`).bind(jobKey).first()) as any;
  return row || null;
}

export async function runWeeklyFinalizerCore(
  db: D1Database,
  params: WeeklyParams,
  deps: WeeklyFinalizerDeps
): Promise<WeeklyFinalizerResult> {
  const t0 = Date.now();
  const now = deps.now ?? (() => Date.now());
  const baseRun = deps.runId ?? makeRunId();
  let processed = 0, finalized = 0, skipped = 0, failed = 0;
  let scopes: WeeklyScopeRef[];
  try {
    scopes = await deps.listReadyScopes();
  } catch (e: any) {
    logEvent({ operation: "weekly_finalizer_v2", trigger: deps.trigger, run_id: baseRun, status: "error", reason_code: "discover_failed", error_code: String(e?.message || e).slice(0, 40) });
    return { ok: false, status: "error", processed_periods: 0, finalized_periods: 0, skipped_locked: 0, failed_periods: 0, error: "DISCOVER_FAILED" };
  }

  const limited = scopes.slice(0, Math.max(1, params.maxPeriods));
  for (const scope of limited) {
    const jobKey = buildWeeklyJobKey(scope.seasonId, scope.weekKey);
    const runId = makeRunId();
    let claim;
    try {
      claim = await claimJob(db, WEEKLY_FINALIZER_TABLE, jobKey, runId, now(), params.staleLockMs, { season_id: scope.seasonId, week_key: scope.weekKey });
    } catch (e: any) {
      // Job table missing → controlled error per period; do NOT mark completed.
      failed++;
      logEvent({ operation: "weekly_finalizer_v2", trigger: deps.trigger, run_id: runId, job_key: jobKey, status: "error", reason_code: "job_table_unavailable", error_code: String(e?.message || e).slice(0, 40) });
      continue;
    }
    if (!claim.claimed) { skipped++; continue; }

    processed++;
    let status = "completed", errCode = "";
    try {
      if (deps.fault) await deps.fault("before_finalize", { scope });
      const r = await deps.finalizeScope(scope);
      if (deps.fault) await deps.fault("after_finalize", { scope });
      if (r.ok) finalized++;
      const fin = now();
      await db.prepare(`UPDATE ${WEEKLY_FINALIZER_TABLE} SET status='completed', completed_at=?, heartbeat_at=?, finalized_periods=?, last_error_code=?, updated_at=? WHERE job_key=? AND run_id=?`)
        .bind(fin, fin, r.ok ? 1 : 0, r.ok ? null : (r.reason || "not_ready"), fin, jobKey, runId).run();
    } catch (e: any) {
      status = "failed"; failed++; errCode = String(e?.message || e).slice(0, 40);
      const fin = now();
      await db.prepare(`UPDATE ${WEEKLY_FINALIZER_TABLE} SET status='failed', failed_at=?, last_error_code=?, heartbeat_at=?, updated_at=? WHERE job_key=? AND run_id=?`)
        .bind(fin, errCode, fin, fin, jobKey, runId).run();
    }
  }

  logEvent({ operation: "weekly_finalizer_v2", trigger: deps.trigger, run_id: baseRun, status: "ok", duration_ms: Date.now() - t0, processed_periods: processed, finalized_periods: finalized, skipped_locked: skipped, failed_periods: failed });
  return { ok: true, status: "ok", processed_periods: processed, finalized_periods: finalized, skipped_locked: skipped, failed_periods: failed };
}
