// Stage 10 — pure helpers for the league-leaderboard SQL V2 path.
//
// V2 pushes the period predicate into SQL (instead of reading a league's full
// league_day_stats history and filtering/aggregating in JS). The ranking formula,
// tie-breaks and order are UNCHANGED — this module just provides the shared
// comparator (matching the legacy inline sort) plus a strict legacy-vs-V2 compare
// used by shadow mode. No DB, no I/O.

export interface LeagueRankRow {
  user_id: number;
  points: number;
  exact_count: number;
  joker_points: number;
  earliest_pick_time: number;
}

// Identical tie-break order to legacy computeLeagueLeaderboard:
//   points DESC, exact_count DESC, joker_points DESC, earliest_pick_time ASC
//   (a 0/absent earliest sorts LAST), user_id ASC.
export function leagueRankComparator(a: LeagueRankRow, b: LeagueRankRow): number {
  const aE = a.earliest_pick_time > 0 ? a.earliest_pick_time : Number.MAX_SAFE_INTEGER;
  const bE = b.earliest_pick_time > 0 ? b.earliest_pick_time : Number.MAX_SAFE_INTEGER;
  return (
    b.points - a.points ||
    b.exact_count - a.exact_count ||
    b.joker_points - a.joker_points ||
    aE - bE ||
    a.user_id - b.user_id
  );
}

/** Sort a copy with the shared comparator (does not mutate the input). */
export function sortLeagueRanking<T extends LeagueRankRow>(rows: T[]): T[] {
  return [...rows].sort(leagueRankComparator);
}

export interface LeagueCompareResult {
  match: boolean;
  legacyRows: number;
  v2Rows: number;
  reason: string; // "match" | "row_count" | "id_set" | "points" | "order" | "tiebreak"
  firstMismatchUserId?: number | null;
}

/**
 * Strict comparison of two already-ranked lists (same shape, same order rule).
 * Compares participant ids, points, tie-break values, rank/order and row count.
 */
export function compareLeagueRankings(legacy: LeagueRankRow[], v2: LeagueRankRow[]): LeagueCompareResult {
  if (legacy.length !== v2.length) {
    return { match: false, legacyRows: legacy.length, v2Rows: v2.length, reason: "row_count" };
  }
  const legacyIds = new Set(legacy.map((r) => r.user_id));
  for (const r of v2) {
    if (!legacyIds.has(r.user_id)) {
      return { match: false, legacyRows: legacy.length, v2Rows: v2.length, reason: "id_set", firstMismatchUserId: r.user_id };
    }
  }
  for (let i = 0; i < legacy.length; i++) {
    const a = legacy[i];
    const b = v2[i];
    if (a.user_id !== b.user_id) {
      return { match: false, legacyRows: legacy.length, v2Rows: v2.length, reason: "order", firstMismatchUserId: a.user_id };
    }
    if (a.points !== b.points) {
      return { match: false, legacyRows: legacy.length, v2Rows: v2.length, reason: "points", firstMismatchUserId: a.user_id };
    }
    const aE = a.earliest_pick_time > 0 ? a.earliest_pick_time : 0;
    const bE = b.earliest_pick_time > 0 ? b.earliest_pick_time : 0;
    if (a.exact_count !== b.exact_count || a.joker_points !== b.joker_points || aE !== bE) {
      return { match: false, legacyRows: legacy.length, v2Rows: v2.length, reason: "tiebreak", firstMismatchUserId: a.user_id };
    }
  }
  return { match: true, legacyRows: legacy.length, v2Rows: v2.length, reason: "match" };
}

// Stage 11 — known named call sites of computeLeagueLeaderboard. Unknown tokens in
// LEAGUE_LEADERBOARD_SQL_V2_CALLSITES are ignored (cannot accidentally enable V2).
export const KNOWN_LEAGUE_SQL_CALLSITES = new Set(["achievement", "quest", "admin", "league_api"]);

/** Parse a CSV/space list of call site tokens; only KNOWN tokens are kept. */
export function parseLeagueSqlCallsites(csv: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!csv) return out;
  for (const part of String(csv).split(/[,\s]+/)) {
    const t = part.trim().toLowerCase();
    if (t && KNOWN_LEAGUE_SQL_CALLSITES.has(t)) out.add(t);
  }
  return out;
}

export interface LeagueSqlPathInput {
  v2Enabled: boolean;
  shadowEnabled: boolean;
  /** The call site is present in the enabled callsite allowlist. */
  callsiteAllowed: boolean;
  /** Period is one V2 supports (week/month/all). day:/season: → always false. */
  periodEligible: boolean;
}
export type LeagueSqlPath = "legacy" | "shadow" | "v2_apply";

/**
 * Decide which path to run (Stage 11 — callsite model):
 *  - V2 off, callsite not allowed, or period not eligible → legacy (default; all
 *    existing prod call sites that pass no callsite resolve here).
 *  - V2 on + callsite allowed + shadow on  → shadow (compute both, RETURN legacy).
 *  - V2 on + callsite allowed + shadow off → v2_apply (return V2; no extra legacy).
 */
export function decideLeagueSqlPath(i: LeagueSqlPathInput): LeagueSqlPath {
  if (!i.v2Enabled || !i.callsiteAllowed || !i.periodEligible) return "legacy";
  if (i.shadowEnabled) return "shadow";
  return "v2_apply";
}
