// Stage 8 — pure, side-effect-free helpers for partner-claims processing V2.
//
// Goal: stop running the heavy pending-claims sweep on every frequent (~10 min)
// cron tick. V2 adds (1) targeted single-claim processing, (2) a dedicated hourly
// sweep with a bounded, keyset-paginated batch, and (3) a safe legacy fallback gate.
// No partner business rules, rewards, or week/hold boundaries change here.

/** Dedicated hourly sweep cron (insurance): minute 7 of every hour. */
export const PARTNER_CLAIMS_SWEEP_CRON = "7 * * * *";
export function isPartnerSweepCron(cron: string | undefined | null): boolean {
  return cron === PARTNER_CLAIMS_SWEEP_CRON;
}

/** The reward ledger is one row per claim (partner_reward_logs UNIQUE(claim_id)). */
export function buildPartnerRewardIdemKey(claimId: number): string {
  return `partner-reward:${claimId}`;
}

export interface PartnerParamSource {
  partnerClaimsBatchSize: number;
  partnerClaimsOverdueMinutes: number;
}
export interface PartnerParams {
  /** Max claims processed per keyset page. */
  batchSize: number;
  /** Hard cap on pages drained per sweep invocation (bounded total work). */
  maxPages: number;
  /** A pending_hold claim overdue by more than this is "stale" → fallback trigger. */
  overdueMs: number;
}
/** Bounded number of keyset pages a single sweep invocation may drain. */
export const PARTNER_SWEEP_MAX_PAGES = 20;
export function resolvePartnerParams(flags: PartnerParamSource): PartnerParams {
  return {
    batchSize: flags.partnerClaimsBatchSize,
    maxPages: PARTNER_SWEEP_MAX_PAGES,
    overdueMs: flags.partnerClaimsOverdueMinutes * 60_000,
  };
}

export type PartnerClaimDue = "due" | "not_due" | "not_pending";

/** Whether a claim is a pending_hold claim whose hold has elapsed (ready to process). */
export function classifyPartnerClaimDue(
  claim: { status?: string | null; hold_until?: number | null } | null | undefined,
  now: number
): PartnerClaimDue {
  if (!claim || claim.status !== "pending_hold") return "not_pending";
  if (claim.hold_until == null || claim.hold_until > now) return "not_due";
  return "due";
}

export interface PartnerFrequentCronInput {
  v2Enabled: boolean;
  fallbackEnabled: boolean;
  /** A pending_hold claim has been overdue longer than overdueMs (sweep missed it). */
  overdueExists: boolean;
}
export interface PartnerFrequentCronDecision {
  runLegacy: boolean;
  reason: string;
}

/**
 * Frequent (~10 min) cron gate for the legacy sweep.
 *  - V2 off                      → run legacy as today (unchanged default).
 *  - V2 on, fallback off         → never run legacy here (hourly sweep handles it).
 *  - V2 on, fallback on, overdue → run legacy as a safety net (V2 fell behind/failed).
 *  - V2 on, fallback on, no overdue → skip (no heavy sweep every 10 min).
 */
export function decidePartnerLegacyOnFrequentCron(i: PartnerFrequentCronInput): PartnerFrequentCronDecision {
  if (!i.v2Enabled) return { runLegacy: true, reason: "v2_off_legacy" };
  if (!i.fallbackEnabled) return { runLegacy: false, reason: "v2_on_fallback_off" };
  if (i.overdueExists) return { runLegacy: true, reason: "overdue_fallback" };
  return { runLegacy: false, reason: "v2_on_no_overdue" };
}
