// M6.1 — manual-only match selection policy. Single source of truth for whether
// any AUTOMATIC Top-3 selection may run. Default OFF: match-day publication is
// strictly admin-only (Apply Selection → MANUAL, or REST). NO I/O.
//
// Rollback: flip AUTO_SELECTION_ENABLED to true and redeploy (redeploying the
// previous api-worker version is the preferred rollback). The legacy AUTO code is
// preserved, not deleted. Historical AUTO days are never rewritten.

export const AUTO_SELECTION_ENABLED = false;

// Whether a caller's requested auto-pick is actually permitted. Requires BOTH an
// explicit opt-in from the caller AND the master switch to be enabled.
export function isAutoPickAllowed(
  requested: boolean | undefined,
  enabled: boolean = AUTO_SELECTION_ENABLED,
): boolean {
  return requested === true && enabled === true;
}

// Whether a PUT /admin/day/top3 request must be rejected because it asks for AUTO
// while automatic selection is disabled.
export function isAutoModeRejected(
  mode: string,
  enabled: boolean = AUTO_SELECTION_ENABLED,
): boolean {
  return mode === "AUTO" && enabled !== true;
}
