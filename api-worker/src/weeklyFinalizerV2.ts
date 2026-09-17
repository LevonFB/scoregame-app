// Stage 6 — pure helpers for the weekly finalizer V2 job model.
// Reuses classifyLock from the daily-case backfill (generic lifecycle logic).

export { classifyLock } from "./dailyCaseBackfillV2";

export const WEEKLY_FINALIZER_TABLE = "weekly_finalizer_jobs";

/** Dedicated hourly cron: minute 5 of every hour. */
export const WEEKLY_FINALIZER_CRON = "5 * * * *";
export function isWeeklyFinalizerCron(cron: string | undefined | null): boolean {
  return cron === WEEKLY_FINALIZER_CRON;
}

/** Job key uniquely includes season + weekly period. */
export function buildWeeklyJobKey(seasonId: number, weekKey: string): string {
  return `weekly-finalizer:${seasonId}:${weekKey}`;
}

/** Basic week-key sanity: a non-empty token without separators we use elsewhere. */
export function isValidWeekKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 32 && !/[\s:/]/.test(value);
}

export interface WeeklyParamSource {
  weeklyFinalizerMaxPeriods: number;
  weeklyFinalizerStaleLockMinutes: number;
}
export interface WeeklyParams {
  maxPeriods: number;
  staleLockMs: number;
}
export function resolveWeeklyParams(flags: WeeklyParamSource): WeeklyParams {
  return {
    maxPeriods: flags.weeklyFinalizerMaxPeriods,
    staleLockMs: flags.weeklyFinalizerStaleLockMinutes * 60_000,
  };
}

// ── Stage 7 — GET /quests/weekly read-skip decision (pure) ──
//
// For allowlisted test users (and ONLY when V2 is enabled), GET /quests/weekly
// becomes a pure read: it never triggers legacy finalize. Non-allowlist users and
// the V2-off case keep the exact Stage 6 behavior. A job-status read failure must
// never fabricate a "completed" status: allowlist → safe legacy fallback,
// non-allowlist → propagate (caller's try/catch handles it = no finalize, as before).

/** Resolved state of the previous-week finalizer job for the GET gate decision. */
export type WeeklyJobState =
  | "completed"
  | "running_fresh"
  | "running_stale"
  | "failed"
  | "missing"
  | "read_error";

/** Map a job row + lock classification to a single state token. */
export function weeklyJobStateOf(
  job: { status?: string | null } | null | undefined,
  lockDecision: string
): WeeklyJobState {
  if (!job) return "missing";
  if (job.status === "completed") return "completed";
  if (job.status === "failed") return "failed";
  if (job.status === "running") return lockDecision === "already_running" ? "running_fresh" : "running_stale";
  return "missing"; // pending / unknown → treated as not-yet-finalized
}

export interface WeeklyGetGateInput {
  v2Enabled: boolean;
  inAllowlist: boolean;
  fallbackEnabled: boolean;
  jobState: WeeklyJobState;
}
export interface WeeklyGetGateDecision {
  runLegacy: boolean;
  /** Non-allowlist read error → rethrow so the caller's try/catch skips finalize (Stage 6). */
  propagateError?: boolean;
  operation:
    | "weekly_get_finalize_skipped"
    | "weekly_get_legacy_fallback"
    | "weekly_get_reconcile_skipped"
    | "job_status_read_failed_fallback";
  reason: string;
}

export function decideWeeklyGetGate(i: WeeklyGetGateInput): WeeklyGetGateDecision {
  // V2 off → unchanged legacy behavior; allowlist ignored entirely.
  if (!i.v2Enabled) {
    return { runLegacy: true, operation: "weekly_get_finalize_skipped", reason: "v2_off_legacy" };
  }

  // Fail-safe: job-status read failed. Never claim "completed".
  if (i.jobState === "read_error") {
    if (i.inAllowlist) {
      return { runLegacy: true, operation: "job_status_read_failed_fallback", reason: "job_status_read_error" };
    }
    // Non-allowlist preserves Stage 6: the read error propagates upstream.
    return { runLegacy: false, propagateError: true, operation: "weekly_get_finalize_skipped", reason: "read_error_propagate" };
  }

  if (i.inAllowlist) {
    // Allowlisted test users → pure read: never run legacy finalize while V2 is on.
    switch (i.jobState) {
      case "completed":     return { runLegacy: false, operation: "weekly_get_reconcile_skipped", reason: "v2_completed" };
      case "running_fresh": return { runLegacy: false, operation: "weekly_get_reconcile_skipped", reason: "v2_running" };
      case "running_stale": return { runLegacy: false, operation: "weekly_get_reconcile_skipped", reason: "v2_stale_skip" };
      case "failed":        return { runLegacy: false, operation: "weekly_get_reconcile_skipped", reason: "v2_failed_skip" };
      case "missing":       return { runLegacy: false, operation: "weekly_get_reconcile_skipped", reason: "v2_absent_skip" };
    }
  }

  // Non-allowlist → Stage 6 behavior unchanged.
  if (i.jobState === "completed") return { runLegacy: false, operation: "weekly_get_finalize_skipped", reason: "v2_completed" };
  if (i.jobState === "running_fresh") return { runLegacy: false, operation: "weekly_get_finalize_skipped", reason: "v2_running" };
  // failed | missing | running_stale
  if (i.fallbackEnabled) return { runLegacy: true, operation: "weekly_get_legacy_fallback", reason: "v2_absent_or_failed" };
  return { runLegacy: false, operation: "weekly_get_finalize_skipped", reason: "fallback_disabled" };
}
