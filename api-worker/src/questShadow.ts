// Stage 4 — pure, side-effect-free helpers for quest event-sync SHADOW mode.
//
// Shadow mode ONLY computes expected daily-quest state and compares it with the
// stored state, emitting a diagnostic. It never writes progress, rewards, balance
// or inventory. This module holds the testable, DB-free parts; the read-only
// compute (SELECT-only) lives in index.ts and reuses evaluateDailyQuestMet().

export const QUEST_SHADOW_SCHEMA_VERSION = 1;

export type QuestEventType =
  | "prediction_saved"
  | "joker_used"
  | "boost_used"
  | "case_opened"
  | "match_scored"
  | "correct_prediction_awarded";

export interface QuestShadowEvent {
  event_type: QuestEventType;
  event_id: string;
  idempotency_key: string;
  user_id: number;
  occurred_at: number;
  period_key: string; // matchday key
  schema_version: number;
  // minimal identifiers only — NEVER initData / tokens / usernames / payloads
  match_id?: string | null;
}

/** Build a minimal, typed shadow event after a confirmed successful action. */
export function buildQuestEvent(
  eventType: QuestEventType,
  userId: number,
  periodKey: string,
  opts?: { matchId?: string | null; occurredAt?: number }
): QuestShadowEvent {
  const occurred = opts?.occurredAt ?? Date.now();
  const idem = buildQuestEventIdempotencyKey(eventType, userId, periodKey, opts?.matchId ?? null);
  return {
    event_type: eventType,
    event_id: idem,
    idempotency_key: idem,
    user_id: userId,
    occurred_at: occurred,
    period_key: periodKey,
    schema_version: QUEST_SHADOW_SCHEMA_VERSION,
    match_id: opts?.matchId ?? null,
  };
}

/** Stable idempotency key: same action on same day/user/match → same key. */
export function buildQuestEventIdempotencyKey(
  eventType: QuestEventType,
  userId: number,
  periodKey: string,
  matchId: string | null
): string {
  return `quest-evt:${eventType}:${periodKey}:${userId}:${matchId ?? "-"}`;
}

// Which daily quest phase (if any) an event maps to. Events without a daily-quest
// mapping are reported as "unsupported" (no artificial support is invented).
const EVENT_PHASE: Partial<Record<QuestEventType, "pick_saved" | "scores_updated">> = {
  prediction_saved: "pick_saved",
  joker_used: "pick_saved",
  boost_used: "pick_saved",
  match_scored: "scores_updated",
  correct_prediction_awarded: "scores_updated",
  // case_opened: intentionally absent → unsupported for daily quests
};

export function eventPhase(eventType: QuestEventType): "pick_saved" | "scores_updated" | null {
  return EVENT_PHASE[eventType] ?? null;
}
export function isSupportedQuestEvent(eventType: QuestEventType): boolean {
  return eventPhase(eventType) !== null;
}

export interface ShadowFlagState {
  questEventSyncV2: boolean;
  questEventSyncShadow: boolean;
}
export interface ShadowDecision {
  run: boolean;
  reason: string;
  warn?: boolean;
}

/**
 * Decide whether the shadow evaluator runs.
 *  - V2 off              → never (current behavior, default).
 *  - V2 on + shadow on   → run (compute + compare only).
 *  - V2 on + shadow off  → do NOT run; warn (apply-mode is forbidden this stage).
 */
export function shouldRunQuestShadow(flags: ShadowFlagState): ShadowDecision {
  if (!flags.questEventSyncV2) return { run: false, reason: "v2_disabled" };
  if (flags.questEventSyncShadow) return { run: true, reason: "shadow_on" };
  return { run: false, reason: "v2_on_shadow_off", warn: true };
}

// ── Stage 5: per-user rollout allowlists (event-driven apply + read-reconcile skip) ──

/** Parse a CSV/space list of positive integer user ids; invalid tokens ignored. */
export function parseUserIdAllowlist(csv: string | undefined | null): Set<number> {
  const out = new Set<number>();
  if (!csv) return out;
  for (const part of String(csv).split(/[,\s]+/)) {
    const t = part.trim();
    if (!/^\d+$/.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.add(n);
  }
  return out;
}

export interface ApplyFlagState {
  applyV2: boolean;
  applyUserIds: Set<number>;
  skipReconcileUserIds: Set<number>;
  // Global kill-switch: when true, skip the redundant read-path reconcile for ALL
  // users (not just the allowlist). Safe because daily quests are already awarded at
  // event time (pick-save + score recalc); this only drops the on-read catch-up.
  skipAll?: boolean;
}

/**
 * Read-reconcile in /me/boosts & /me/cases is skipped for a user ONLY when all hold:
 *   apply V2 enabled, user in apply allowlist, user in reconcile-skip allowlist.
 * Otherwise the legacy reconcile runs (default behavior unchanged).
 */
export function shouldSkipReadReconcile(userId: number, f: ApplyFlagState): { skip: boolean; reason: string } {
  if (f.skipAll) return { skip: true, reason: "global_disable" };
  if (!f.applyV2) return { skip: false, reason: "apply_v2_disabled" };
  if (!f.applyUserIds.has(userId)) return { skip: false, reason: "not_in_apply_allowlist" };
  if (!f.skipReconcileUserIds.has(userId)) return { skip: false, reason: "not_in_skip_allowlist" };
  return { skip: true, reason: "allowlisted" };
}

/** Whether event-driven apply is the authoritative path for this user. */
export function isQuestApplyUser(userId: number, f: ApplyFlagState): boolean {
  return f.applyV2 && f.applyUserIds.has(userId);
}

export type QuestShadowResult =
  | "match"
  | "progress_mismatch"
  | "completion_mismatch"
  | "reward_mismatch"
  | "missing_progress"
  | "unsupported"
  | "error";

export interface QuestCompareInput {
  supported: boolean;
  hasStoredRow: boolean;
  expectedCompleted: boolean;
  storedCompleted: boolean;
  expectedRewardEligible: boolean;
  storedRewarded: boolean;
}

/** Classify a single quest's shadow comparison. Pure. */
export function classifyQuestShadow(i: QuestCompareInput): QuestShadowResult {
  if (!i.supported) return "unsupported";
  if (i.expectedCompleted && !i.hasStoredRow) return "missing_progress";
  if (i.expectedCompleted !== i.storedCompleted) return "completion_mismatch";
  if (i.expectedRewardEligible !== i.storedRewarded) return "reward_mismatch";
  return "match";
}
