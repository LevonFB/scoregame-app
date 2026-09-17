// Pure control-flow helper for the admin candidates refresh decision (M6). NO I/O.
//
// Centralizes the rule that the admin "Refresh" is SAFE by default and only runs
// the legacy AUTO path on an explicit, confirmed request. Crucially, an implicit
// empty-day refresh resolves to SAFE — the old hidden AUTO fallback is removed.

export type AdminRefreshDecision = "none" | "safe" | "legacy-auto";

export function decideAdminRefresh(params: {
  hasCandidates: boolean;
  refreshRequested: boolean;
  legacyAuto: boolean;
}): AdminRefreshDecision {
  const needsRefresh = !params.hasCandidates || params.refreshRequested;
  if (!needsRefresh) return "none";
  return params.legacyAuto ? "legacy-auto" : "safe";
}
