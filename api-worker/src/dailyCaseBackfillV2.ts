// Stage 3 — pure, side-effect-free helpers for the daily-case backfill V2 job.
//
// All D1 access lives in index.ts; this module holds only the testable decision
// logic: matchday validation, job-key construction, lock classification and the
// per-case idempotency key. Reused by unit tests AND the orchestrator.

export const BACKFILL_JOB_PREFIX = "daily-case-backfill";

/** Dedicated cron for the V2 apply: 04:15 UTC = 07:15 MSK (after the day boundary). */
export const BACKFILL_V2_CRON = "15 4 * * *";

/** Only this exact cron triggers the V2 apply — never the 10-minute or daily-sync crons. */
export function isBackfillV2Cron(cron: string | undefined | null): boolean {
  return cron === BACKFILL_V2_CRON;
}

/** A football-day matchday key is a calendar date string YYYY-MM-DD. */
const MATCHDAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidMatchdayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!MATCHDAY_RE.test(value)) return false;
  // Reject impossible calendar dates (e.g. 2026-13-40).
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

/** Stable job key for a matchday. One job per football day. */
export function buildJobKey(matchday: string): string {
  return `${BACKFILL_JOB_PREFIX}:${matchday}`;
}

/** Conceptual per-case idempotency key (the real guard is daily_cases.earned). */
export function buildCaseIdempotencyKey(matchday: string, userId: number, caseType = "daily_free"): string {
  return `daily-case:${matchday}:${userId}:${caseType}`;
}

export type JobStatus = "pending" | "running" | "completed" | "failed" | "dry_run_completed";

export interface BackfillJobRow {
  status: JobStatus;
  run_id?: string | null;
  heartbeat_at?: number | null;
}

export type LockDecision =
  | "claim_new" // no row yet
  | "claim_retry" // previous attempt failed → retry allowed
  | "claim_stale" // running but heartbeat is stale → take over
  | "already_running" // a fresh run owns it
  | "already_completed"; // nothing to do

/**
 * Decide whether a backfill run may claim the job for `matchday`, given the
 * existing job row (or null) and the staleness threshold. Pure.
 */
export function classifyLock(
  existing: BackfillJobRow | null | undefined,
  nowMs: number,
  staleMs: number
): LockDecision {
  if (!existing) return "claim_new";
  switch (existing.status) {
    case "completed":
      return "already_completed";
    case "failed":
      return "claim_retry";
    case "pending":
      return "claim_retry";
    case "dry_run_completed":
      // dry-run never owns the production job; a real apply may proceed.
      return "claim_retry";
    case "running": {
      const hb = Number(existing.heartbeat_at ?? 0);
      if (nowMs - hb >= staleMs) return "claim_stale";
      return "already_running";
    }
    default:
      return "claim_retry";
  }
}

export interface BackfillParams {
  batchSize: number;
  maxBatches: number;
  staleLockMs: number;
}

export interface BackfillParamSource {
  dailyCaseBackfillBatchSize: number;
  dailyCaseBackfillMaxBatches: number;
  dailyCaseBackfillStaleLockMinutes: number;
}

/** Project resolved feature flags into backfill runtime params. */
export function resolveBackfillParams(flags: BackfillParamSource): BackfillParams {
  return {
    batchSize: flags.dailyCaseBackfillBatchSize,
    maxBatches: flags.dailyCaseBackfillMaxBatches,
    staleLockMs: flags.dailyCaseBackfillStaleLockMinutes * 60_000,
  };
}
