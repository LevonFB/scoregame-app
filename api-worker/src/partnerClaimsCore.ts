// Stage 8 — testable orchestration for the partner-claims V2 hourly sweep.
//
// Keyset pagination over claim id (no full-history scan, no OFFSET). Each due claim
// is processed via the injected `processOne` (production passes the existing
// processPendingPartnerClaim, which is idempotent through partner_reward_logs). A
// single bad claim is isolated with try/catch so it never blocks the rest of the
// batch. Production passes NO fault hook; tests drive faults via dependency injection.

import { logEvent, makeRunId } from "./obs";
import type { PartnerParams } from "./partnerClaimsV2";

export interface PartnerSweepClaim {
  id: number;
  campaign_id: number;
  user_id: number;
  status: string;
  hold_until: number | null;
}

export interface PartnerSweepDeps {
  trigger: string;
  /** Keyset page of due claims with id > cursorId, ascending, up to `limit`. */
  listDuePage: (cursorId: number, limit: number) => Promise<PartnerSweepClaim[]>;
  /** Process one claim (idempotent). Returns ok + optional reason. */
  processOne: (claim: PartnerSweepClaim) => Promise<{ ok: boolean; reason?: string | null }>;
  now?: () => number;
  fault?: (phase: "before_process", ctx: { claim: PartnerSweepClaim }) => void | Promise<void>;
  runId?: string;
}

export interface PartnerSweepResult {
  ok: boolean;
  processed: number;
  granted: number;
  failed: number;
  pages: number;
  last_id: number;
  has_more: boolean;
}

export async function runPartnerSweepCore(
  params: PartnerParams,
  deps: PartnerSweepDeps
): Promise<PartnerSweepResult> {
  const t0 = Date.now();
  const runId = deps.runId ?? makeRunId();
  const batchSize = Math.max(1, params.batchSize);
  const maxPages = Math.max(1, params.maxPages);

  let processed = 0, granted = 0, failed = 0, pages = 0;
  let cursor = 0;
  let hasMore = false;

  for (let page = 0; page < maxPages; page++) {
    let claims: PartnerSweepClaim[];
    try {
      claims = await deps.listDuePage(cursor, batchSize);
    } catch (e: any) {
      logEvent({ operation: "partner_claims_v2", trigger: deps.trigger, run_id: runId, status: "error", reason_code: "list_failed", error_code: String(e?.message || e).slice(0, 40) });
      return { ok: false, processed, granted, failed, pages, last_id: cursor, has_more: false };
    }
    if (!claims.length) break;
    pages++;

    for (const claim of claims) {
      cursor = Math.max(cursor, claim.id);
      try {
        if (deps.fault) await deps.fault("before_process", { claim });
        const r = await deps.processOne(claim);
        processed++;
        if (r.ok) granted++; else failed++;
      } catch (e: any) {
        // One invalid/failing claim must not block the batch.
        failed++;
        logEvent({ operation: "partner_claims_v2", trigger: deps.trigger, run_id: runId, status: "claim_error", claim_id: claim.id, reason_code: "process_failed", error_code: String(e?.message || e).slice(0, 40) });
      }
    }

    if (claims.length < batchSize) break;
    // A full page means there may be more; if we hit maxPages, report has_more.
    if (page + 1 >= maxPages) hasMore = true;
  }

  logEvent({ operation: "partner_claims_v2", trigger: deps.trigger, run_id: runId, status: "ok", duration_ms: Date.now() - t0, processed_users: processed, granted, failed, pages, last_id: cursor, has_more: hasMore });
  return { ok: true, processed, granted, failed, pages, last_id: cursor, has_more: hasMore };
}
