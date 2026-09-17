// Stage 2 — pure, side-effect-free comparison of the legacy all-time leaderboard
// (POST /leaderboard, buildLeaderboard) against the scoped leaderboard
// (/leaderboards/global, queryGlobalLeaderboardRows).
//
// This is used ONLY in an admin/test-gated shadow mode to LOG divergences. The
// user always keeps the legacy result. No formulas are changed here.
//
// IMPORTANT (documented divergence): the scoped endpoint is NOT a drop-in for the
// legacy one — it does not return `me`/`isAdmin`/`permissions` and its default
// period is season-scoped, not all-time. So divergence is expected; this helper
// just makes it measurable.

export interface LbEntry {
  userId: string;
  points: number;
}

export interface LbCompareInput {
  oldRows: LbEntry[];
  scopedRows: LbEntry[];
  meUserId: string;
  /** How many top entries to compare for ordering. */
  topN?: number;
}

export interface LbCompareResult {
  divergent: boolean;
  reasons: string[];
  oldCount: number;
  scopedCount: number;
  topOldIds: string[];
  topScopedIds: string[];
  meRankOld: number | null;
  meRankScoped: number | null;
  pointMismatchCount: number;
  participantsMatch: boolean;
}

function rankOf(rows: LbEntry[], userId: string): number | null {
  const idx = rows.findIndex((r) => r.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}

function topIds(rows: LbEntry[], n: number): string[] {
  return rows.slice(0, n).map((r) => r.userId);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Compare two leaderboard projections and describe how they diverge.
 * Pure: no I/O, no logging — the caller logs the result (without PII).
 */
export function compareLeaderboards(input: LbCompareInput): LbCompareResult {
  const topN = input.topN ?? 10;
  const oldRows = input.oldRows;
  const scopedRows = input.scopedRows;

  const reasons: string[] = [];

  const oldCount = oldRows.length;
  const scopedCount = scopedRows.length;
  if (oldCount !== scopedCount) reasons.push("count");

  const meRankOld = rankOf(oldRows, input.meUserId);
  const meRankScoped = rankOf(scopedRows, input.meUserId);
  if (meRankOld !== meRankScoped) reasons.push("me_rank");

  const topOldIds = topIds(oldRows, topN);
  const topScopedIds = topIds(scopedRows, topN);
  if (!arraysEqual(topOldIds, topScopedIds)) reasons.push("top_order");

  const oldIds = new Set(oldRows.map((r) => r.userId));
  const scopedIds = new Set(scopedRows.map((r) => r.userId));
  let participantsMatch = oldIds.size === scopedIds.size;
  if (participantsMatch) {
    for (const id of oldIds) {
      if (!scopedIds.has(id)) {
        participantsMatch = false;
        break;
      }
    }
  }
  if (!participantsMatch) reasons.push("participants");

  // Points mismatch among users present in BOTH projections.
  const scopedPoints = new Map(scopedRows.map((r) => [r.userId, r.points]));
  let pointMismatchCount = 0;
  for (const r of oldRows) {
    const sp = scopedPoints.get(r.userId);
    if (sp !== undefined && sp !== r.points) pointMismatchCount++;
  }
  if (pointMismatchCount > 0) reasons.push("points");

  return {
    divergent: reasons.length > 0,
    reasons,
    oldCount,
    scopedCount,
    topOldIds,
    topScopedIds,
    meRankOld,
    meRankScoped,
    pointMismatchCount,
    participantsMatch,
  };
}
