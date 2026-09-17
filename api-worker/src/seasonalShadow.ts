// Stage 13 — pure, side-effect-free helpers for SEASONAL quest shadow mode.
//
// Shadow mode ONLY computes expected seasonal-quest state (via the existing read-only
// evaluator calculateAchievementProgress, in index.ts) and compares it with the
// stored state, emitting a diagnostic. It NEVER writes progress, rewards, balance or
// inventory. This module holds the DB-free, testable parts.

export const SEASONAL_SHADOW_SCHEMA_VERSION = 1;

// Real actions that can move seasonal progress (only those with actual call sites
// are emitted). Reading seasonal endpoints (e.g. /quests/seasonal) is NOT an event.
export type SeasonalEventType =
  | "prediction_saved"
  | "joker_used"
  | "prediction_scored"
  | "points_awarded"
  | "daily_quest_completed"
  | "weekly_quest_completed"
  | "case_opened"
  | "boost_used"
  | "streak_changed";

export interface SeasonalShadowEvent {
  event_type: SeasonalEventType;
  event_id: string;
  user_id: number;
  occurred_at: number;
  season_key: string;
  schema_version: number;
}

export function buildSeasonalEvent(
  eventType: SeasonalEventType,
  userId: number,
  seasonKey: string,
  opts?: { occurredAt?: number }
): SeasonalShadowEvent {
  const occurred = opts?.occurredAt ?? Date.now();
  return {
    event_type: eventType,
    event_id: `seasonal-evt:${eventType}:${seasonKey}:${userId}`,
    user_id: userId,
    occurred_at: occurred,
    season_key: seasonKey,
    schema_version: SEASONAL_SHADOW_SCHEMA_VERSION,
  };
}

export interface ShadowFlagState {
  seasonalEventSyncV2: boolean;
  seasonalEventSyncShadow: boolean;
}
export interface ShadowDecision {
  run: boolean;
  reason: string;
  warn?: boolean;
}

/**
 * Decide whether the seasonal shadow evaluator runs (mirrors the daily-quest gate):
 *  - V2 off             → never (current behavior, default).
 *  - V2 on + shadow on  → run (compute + compare only).
 *  - V2 on + shadow off → do NOT run; warn (apply-mode is forbidden this stage).
 */
export function shouldRunSeasonalShadow(flags: ShadowFlagState): ShadowDecision {
  if (!flags.seasonalEventSyncV2) return { run: false, reason: "v2_disabled" };
  if (flags.seasonalEventSyncShadow) return { run: true, reason: "shadow_on" };
  return { run: false, reason: "v2_on_shadow_off", warn: true };
}

export type SeasonalShadowResult =
  | "match"
  | "progress_mismatch"
  | "completion_mismatch"
  | "reward_mismatch"
  | "missing_progress"
  | "unsupported"
  | "error";

export interface SeasonalQuestCompareInput {
  supported: boolean;          // condition is evaluable
  hasStoredRow: boolean;       // a user_task_progress(season) row exists
  expectedProgress: number;
  storedProgress: number;
  expectedCompleted: boolean;
  storedCompleted: boolean;    // completed_at != null
  expectedRewardEligible: boolean;
  storedRewarded: boolean;     // reward_granted == 1
}

/** Classify a single seasonal quest's shadow comparison. Pure. */
export function classifySeasonalShadow(i: SeasonalQuestCompareInput): SeasonalShadowResult {
  if (!i.supported) return "unsupported";
  if (i.expectedCompleted && !i.hasStoredRow) return "missing_progress";
  if (i.expectedCompleted !== i.storedCompleted) return "completion_mismatch";
  if (i.expectedRewardEligible !== i.storedRewarded) return "reward_mismatch";
  // Only meaningful when a row is stored — legacy stores no partial progress for
  // incomplete global tasks, so absent-row + partial-progress is NOT a mismatch.
  if (i.hasStoredRow && i.expectedProgress !== i.storedProgress) return "progress_mismatch";
  return "match";
}
