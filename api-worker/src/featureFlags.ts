// Stage 1 — safe optimization groundwork.
//
// Centralized, side-effect-free feature flag parsing for api-worker.
//
// Design rules (see SAFE_OPTIMIZATION_STAGE_1_REPORT.md):
//  - Every flag is independent and controls exactly one future optimization area.
//  - A missing env variable MUST preserve current production behavior (safe default).
//  - An invalid / unknown value MUST fall back to the safe default (never crash,
//    never silently enable a V2 path because of a typo).
//  - Boolean parsing is explicit — we do NOT use Boolean(env.X), because the string
//    "false" is truthy and would wrongly enable a flag.
//
// IMPORTANT: At Stage 1 these flags are only *resolved* (and optionally logged as a
// decision). No V2 control-flow branch is implemented yet, so with default values the
// existing behavior is byte-for-byte unchanged.

/** Truthy / falsy string tokens accepted by the boolean parser (case-insensitive). */
const TRUE_TOKENS = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "off"]);

/**
 * Parse a boolean feature flag from a raw env string.
 *
 * - undefined / null / empty / whitespace-only  -> def
 * - recognized true token  ("true","1","yes","on")  -> true
 * - recognized false token ("false","0","no","off") -> false
 * - any other (unknown) value -> def   (typo cannot accidentally flip a flag)
 */
export function parseBoolFlag(value: string | undefined | null, def: boolean): boolean {
  if (value == null) return def;
  const v = value.trim().toLowerCase();
  if (v === "") return def;
  if (TRUE_TOKENS.has(v)) return true;
  if (FALSE_TOKENS.has(v)) return false;
  return def;
}

export interface IntFlagOptions {
  def: number;
  min: number;
  max: number;
}

/**
 * Parse an integer feature flag with explicit bounds.
 *
 * - undefined / empty / non-numeric / NaN -> def
 * - value < min or value > max            -> def (rejected, not clamped, to make
 *                                            misconfiguration obvious and safe)
 * - otherwise -> the parsed integer
 */
export function parseIntFlag(value: string | undefined | null, opts: IntFlagOptions): number {
  const { def, min, max } = opts;
  if (value == null) return def;
  const v = value.trim();
  if (v === "") return def;
  // Reject anything that is not a clean integer (e.g. "2.5", "abc", "2x").
  if (!/^[+-]?\d+$/.test(v)) return def;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  if (n < min || n > max) return def;
  return n;
}

/** Subset of Env this module reads. Kept narrow so it is trivially testable. */
export interface ApiFlagEnv {
  USE_SCOPED_LEADERBOARD_ON_STARTUP?: string;
  DAILY_CASE_BACKFILL_V2_ENABLED?: string;
  DAILY_CASE_LAZY_FALLBACK_ENABLED?: string;
  QUEST_EVENT_SYNC_V2_ENABLED?: string;
  QUEST_EVENT_SYNC_SHADOW_MODE?: string;
  QUEST_EVENT_APPLY_V2_ENABLED?: string;
  WEEKLY_FINALIZER_V2_ENABLED?: string;
  WEEKLY_GET_FALLBACK_ENABLED?: string;
  // Stage 7 — per-user allowlist that makes GET /quests/weekly a pure read.
  // Empty (default) → nobody affected; parsed via parseUserIdAllowlist (positive ints only).
  WEEKLY_GET_FALLBACK_SKIP_USER_IDS?: string;
  // Stage 3 — daily case backfill V2 tuning (independent, safe defaults).
  DAILY_CASE_BACKFILL_BATCH_SIZE?: string;
  DAILY_CASE_BACKFILL_MAX_BATCHES?: string;
  DAILY_CASE_BACKFILL_STALE_LOCK_MINUTES?: string;
  // Stage 16 — UTC hour at which the shared cron runs the daily-case backfill branch.
  DAILY_CASE_BACKFILL_HOUR_UTC?: string;
  // Stage 6 — weekly finalizer V2 tuning.
  WEEKLY_FINALIZER_MAX_PERIODS?: string;
  WEEKLY_FINALIZER_STALE_LOCK_MINUTES?: string;
  // Stage 8 — partner claims processing V2 (independent, safe defaults).
  PARTNER_CLAIMS_V2_ENABLED?: string;
  PARTNER_CLAIMS_LEGACY_CRON_FALLBACK_ENABLED?: string;
  PARTNER_CLAIMS_BATCH_SIZE?: string;
  PARTNER_CLAIMS_OVERDUE_MINUTES?: string;
  // Stage 9 — home leaderboard load reduction (frontend-driven; exposed via
  // /app-sections/visibility). Backend also coalesces in-flight global computations.
  HOME_RATING_DEDUPE_V2_ENABLED?: string;
  HOME_LEAGUES_LAZY_LOAD_V2_ENABLED?: string;
  // Stage 10 — league leaderboard SQL V2 (period predicate pushed into SQL).
  LEAGUE_LEADERBOARD_SQL_V2_ENABLED?: string;
  LEAGUE_LEADERBOARD_SQL_SHADOW_ENABLED?: string;
  LEAGUE_LEADERBOARD_SQL_V2_USER_IDS?: string;
  // Stage 13 — seasonal quest/level event-sync shadow (compute+compare only).
  SEASONAL_EVENT_SYNC_V2_ENABLED?: string;
  SEASONAL_EVENT_SYNC_SHADOW_MODE?: string;
  // Stage 14 — seasonal event-driven apply + read-only endpoints (allowlist only).
  SEASONAL_EVENT_APPLY_V2_ENABLED?: string;
  // Season-prediction auto-submit: once a deadline has passed, promote the last saved
  // draft to 'submitted' so a user who filled the table but never confirmed still counts.
  SEASON_PREDICTION_AUTOSUBMIT_ENABLED?: string;
  SEASON_PREDICTION_AUTOSUBMIT_MAX_ENTRIES?: string;
  SEASON_PREDICTION_AUTOSUBMIT_GRACE_HOURS?: string;
}

export interface ApiFeatureFlags {
  /** Use scoped leaderboard on startup instead of legacy POST /leaderboard. Default false = legacy. */
  useScopedLeaderboardOnStartup: boolean;
  /** New daily case backfill implementation. Default false = legacy backfill. */
  dailyCaseBackfillV2: boolean;
  /** Lazy per-isolate daily case fallback. Default true = current behavior. */
  dailyCaseLazyFallback: boolean;
  /** Event-driven quest sync v2. Default false = current inline sync. */
  questEventSyncV2: boolean;
  /** Shadow mode for quest sync v2 (compute but do not apply). Inert unless v2 on. Default false. */
  questEventSyncShadow: boolean;
  /** Stage 5: allow event-driven apply + per-user read-reconcile skip. Default false. */
  questEventApplyV2: boolean;
  /** New weekly finalizer. Default false = legacy finalizer. */
  weeklyFinalizerV2: boolean;
  /** Keep weekly finalize fallback inside GET /quests/weekly. Default true = current behavior. */
  weeklyGetFallback: boolean;
  /** Stage 3: eligible-users batch size for backfill V2. Default 200. */
  dailyCaseBackfillBatchSize: number;
  /** Stage 3: max batches processed per V2 invocation. Default 20. */
  dailyCaseBackfillMaxBatches: number;
  /** Stage 3: minutes after which a `running` V2 job is considered stale. Default 15. */
  dailyCaseBackfillStaleLockMinutes: number;
  /** Stage 16: UTC hour for the shared-cron daily backfill branch. Default 4 (07:00 MSK). */
  dailyCaseBackfillHourUtc: number;
  /** Stage 6: max weekly periods finalized per V2 invocation. Default 10. */
  weeklyFinalizerMaxPeriods: number;
  /** Stage 6: minutes after which a `running` weekly job is stale. Default 30. */
  weeklyFinalizerStaleLockMinutes: number;
  /** Stage 8: partner-claims V2 (targeted + hourly sweep). Default false = legacy frequent sweep. */
  partnerClaimsV2: boolean;
  /** Stage 8: allow legacy frequent-cron sweep as a safety net under V2. Default true. */
  partnerClaimsLegacyCronFallback: boolean;
  /** Stage 8: claims processed per keyset page in the sweep. Default 25. */
  partnerClaimsBatchSize: number;
  /** Stage 8: minutes a due pending_hold claim may lag before the legacy fallback fires. Default 120. */
  partnerClaimsOverdueMinutes: number;
  /** Stage 9: dedupe identical global leaderboard requests on home. Default false = current behavior. */
  homeRatingDedupeV2: boolean;
  /** Stage 9: lazy-load league leaderboards on home (only visible/primary). Default false = eager. */
  homeLeaguesLazyLoadV2: boolean;
  /** Stage 10: SQL-filtered league leaderboard computation. Default false = legacy JS-filter. */
  leagueLeaderboardSqlV2: boolean;
  /** Stage 10: shadow-compare legacy vs V2 (compute both, return legacy). Default false. */
  leagueLeaderboardSqlShadow: boolean;
  /** Stage 13: seasonal event-sync V2 (inert unless shadow on). Default false. */
  seasonalEventSyncV2: boolean;
  /** Stage 13: seasonal shadow mode (compute+compare, no writes). Default false. */
  seasonalEventSyncShadow: boolean;
  /** Stage 14: seasonal event-driven apply + read-skip (allowlist only). Default false. */
  seasonalEventApplyV2: boolean;
  /** Auto-submit season-prediction drafts once their deadline passed. Default false = drafts stay drafts. */
  seasonPredictionAutoSubmit: boolean;
  /** Max entries auto-submitted per cron tick (leftovers roll over to the next hour). Default 300. */
  seasonPredictionAutoSubmitMaxEntries: number;
  /** How long after a deadline the sweep still runs, in hours. Default 168 (7 days). */
  seasonPredictionAutoSubmitGraceHours: number;
}

/**
 * Resolve all api-worker feature flags from env, applying safe defaults that
 * preserve current production behavior when variables are absent or invalid.
 */
export function resolveApiFlags(env: ApiFlagEnv | undefined | null): ApiFeatureFlags {
  const e: ApiFlagEnv = env ?? {};
  return {
    useScopedLeaderboardOnStartup: parseBoolFlag(e.USE_SCOPED_LEADERBOARD_ON_STARTUP, false),
    dailyCaseBackfillV2: parseBoolFlag(e.DAILY_CASE_BACKFILL_V2_ENABLED, false),
    dailyCaseLazyFallback: parseBoolFlag(e.DAILY_CASE_LAZY_FALLBACK_ENABLED, true),
    questEventSyncV2: parseBoolFlag(e.QUEST_EVENT_SYNC_V2_ENABLED, false),
    questEventSyncShadow: parseBoolFlag(e.QUEST_EVENT_SYNC_SHADOW_MODE, false),
    questEventApplyV2: parseBoolFlag(e.QUEST_EVENT_APPLY_V2_ENABLED, false),
    weeklyFinalizerV2: parseBoolFlag(e.WEEKLY_FINALIZER_V2_ENABLED, false),
    weeklyGetFallback: parseBoolFlag(e.WEEKLY_GET_FALLBACK_ENABLED, true),
    dailyCaseBackfillBatchSize: parseIntFlag(e.DAILY_CASE_BACKFILL_BATCH_SIZE, { def: 200, min: 10, max: 1000 }),
    dailyCaseBackfillMaxBatches: parseIntFlag(e.DAILY_CASE_BACKFILL_MAX_BATCHES, { def: 20, min: 1, max: 100 }),
    dailyCaseBackfillStaleLockMinutes: parseIntFlag(e.DAILY_CASE_BACKFILL_STALE_LOCK_MINUTES, { def: 15, min: 1, max: 240 }),
    dailyCaseBackfillHourUtc: parseIntFlag(e.DAILY_CASE_BACKFILL_HOUR_UTC, { def: 4, min: 0, max: 23 }),
    weeklyFinalizerMaxPeriods: parseIntFlag(e.WEEKLY_FINALIZER_MAX_PERIODS, { def: 10, min: 1, max: 50 }),
    weeklyFinalizerStaleLockMinutes: parseIntFlag(e.WEEKLY_FINALIZER_STALE_LOCK_MINUTES, { def: 30, min: 1, max: 240 }),
    partnerClaimsV2: parseBoolFlag(e.PARTNER_CLAIMS_V2_ENABLED, false),
    partnerClaimsLegacyCronFallback: parseBoolFlag(e.PARTNER_CLAIMS_LEGACY_CRON_FALLBACK_ENABLED, true),
    partnerClaimsBatchSize: parseIntFlag(e.PARTNER_CLAIMS_BATCH_SIZE, { def: 25, min: 1, max: 200 }),
    partnerClaimsOverdueMinutes: parseIntFlag(e.PARTNER_CLAIMS_OVERDUE_MINUTES, { def: 120, min: 1, max: 10080 }),
    homeRatingDedupeV2: parseBoolFlag(e.HOME_RATING_DEDUPE_V2_ENABLED, false),
    homeLeaguesLazyLoadV2: parseBoolFlag(e.HOME_LEAGUES_LAZY_LOAD_V2_ENABLED, false),
    leagueLeaderboardSqlV2: parseBoolFlag(e.LEAGUE_LEADERBOARD_SQL_V2_ENABLED, false),
    leagueLeaderboardSqlShadow: parseBoolFlag(e.LEAGUE_LEADERBOARD_SQL_SHADOW_ENABLED, false),
    seasonalEventSyncV2: parseBoolFlag(e.SEASONAL_EVENT_SYNC_V2_ENABLED, false),
    seasonalEventSyncShadow: parseBoolFlag(e.SEASONAL_EVENT_SYNC_SHADOW_MODE, false),
    seasonalEventApplyV2: parseBoolFlag(e.SEASONAL_EVENT_APPLY_V2_ENABLED, false),
    seasonPredictionAutoSubmit: parseBoolFlag(e.SEASON_PREDICTION_AUTOSUBMIT_ENABLED, false),
    seasonPredictionAutoSubmitMaxEntries: parseIntFlag(e.SEASON_PREDICTION_AUTOSUBMIT_MAX_ENTRIES, { def: 300, min: 10, max: 5000 }),
    seasonPredictionAutoSubmitGraceHours: parseIntFlag(e.SEASON_PREDICTION_AUTOSUBMIT_GRACE_HOURS, { def: 168, min: 1, max: 720 }),
  };
}
