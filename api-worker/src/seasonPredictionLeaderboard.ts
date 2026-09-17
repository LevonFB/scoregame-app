// Stage S4 — read-only top-5 league leaderboards.
//
// Pure, DB-free ranking/sorting/pagination logic so it can be unit-tested
// without auth or D1. The HTTP layer (index.ts) fetches rows from
// season_prediction_user_scores (joined to user_entries for last_submitted_at),
// maps them into LeaderboardMetricRow, then uses these helpers. No scores are
// mutated, no recalc is triggered, no rewards are written here.

export const LEADERBOARD_TOP_LEAGUE_CODES = ["PL", "PD", "SA", "BL1", "FL1"] as const;
export const LEADERBOARD_DEFAULT_LIMIT = 50;
export const LEADERBOARD_MAX_LIMIT = 100;

export type LeaderboardMetricRow = {
  user_id: number;
  total_points: number;
  max_possible_points: number;
  exact_positions: number;
  errors_le_1: number;
  errors_le_2: number;
  champion_correct: number;
  ucl_zone_correct: number;
  relegation_zone_correct: number;
  // Overall leaderboard only — how many of the 5 top leagues the user is scored in.
  scored_leagues_count?: number;
  // For per-league this is the entry's last_submitted_at; for overall it is the
  // latest submission across the user's scored leagues. null sorts last.
  last_submitted_at: number | null;
  scored_at?: number | null;
};

export function leaderboardPointsPct(total: number, max: number): number {
  return max > 0 ? Math.round((total / max) * 10000) / 10000 : 0;
}

export function clampLeaderboardLimit(limit: unknown): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return LEADERBOARD_DEFAULT_LIMIT;
  return Math.min(LEADERBOARD_MAX_LIMIT, n);
}

export function normalizeLeaderboardOffset(offset: unknown): number {
  const n = Math.floor(Number(offset));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// A missing last_submitted_at must always sort to the very end of the tiebreak.
function submittedAscTiebreak(a: LeaderboardMetricRow, b: LeaderboardMetricRow): number {
  const av = a.last_submitted_at == null ? Number.POSITIVE_INFINITY : Number(a.last_submitted_at);
  const bv = b.last_submitted_at == null ? Number.POSITIVE_INFINITY : Number(b.last_submitted_at);
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

// Per-league tiebreakers (all DESC except submission time ASC and user_id ASC):
// total_points, champion_correct, exact_positions, errors_le_1, errors_le_2,
// ucl_zone_correct, relegation_zone_correct, last_submitted_at ASC, user_id ASC.
export function comparePerLeague(a: LeaderboardMetricRow, b: LeaderboardMetricRow): number {
  return (
    b.total_points - a.total_points
    || b.champion_correct - a.champion_correct
    || b.exact_positions - a.exact_positions
    || b.errors_le_1 - a.errors_le_1
    || b.errors_le_2 - a.errors_le_2
    || b.ucl_zone_correct - a.ucl_zone_correct
    || b.relegation_zone_correct - a.relegation_zone_correct
    || submittedAscTiebreak(a, b)
    || a.user_id - b.user_id
  );
}

// Overall top-5 tiebreakers: total_points DESC, champion_correct DESC,
// exact_positions DESC, errors_le_2 DESC, ucl_zone_correct DESC,
// scored_leagues_count DESC, latest last_submitted_at ASC, user_id ASC.
// scored_leagues_count is placed AFTER the accuracy metrics (the "safe" S4
// choice): two users with identical accuracy but different coverage are ranked
// by who covered more leagues, without letting coverage override accuracy.
export function compareOverall(a: LeaderboardMetricRow, b: LeaderboardMetricRow): number {
  return (
    b.total_points - a.total_points
    || b.champion_correct - a.champion_correct
    || b.exact_positions - a.exact_positions
    || b.errors_le_2 - a.errors_le_2
    || b.ucl_zone_correct - a.ucl_zone_correct
    || (b.scored_leagues_count || 0) - (a.scored_leagues_count || 0)
    || submittedAscTiebreak(a, b)
    || a.user_id - b.user_id
  );
}

// A per-league score row before overall aggregation (carries its tournament_code).
export type RawLeagueScoreRow = LeaderboardMetricRow & { tournament_code: string };

// Aggregate the raw per-league score rows into one overall row per user.
// Works for ANY subset of the 5 leagues: a user scored only in PL gets
// scored_leagues_count = 1 (it does NOT require all 5 leagues to be scored).
export function aggregateOverallTopLeaguesLeaderboard(rows: RawLeagueScoreRow[]): LeaderboardMetricRow[] {
  const byUser = new Map<number, LeaderboardMetricRow & { _codes: Set<string> }>();
  for (const r of rows) {
    const userId = Number(r.user_id);
    let agg = byUser.get(userId);
    if (!agg) {
      agg = {
        user_id: userId,
        total_points: 0,
        max_possible_points: 0,
        exact_positions: 0,
        errors_le_1: 0,
        errors_le_2: 0,
        champion_correct: 0,
        ucl_zone_correct: 0,
        relegation_zone_correct: 0,
        scored_leagues_count: 0,
        last_submitted_at: null,
        scored_at: null,
        _codes: new Set<string>(),
      };
      byUser.set(userId, agg);
    }
    agg.total_points += Number(r.total_points || 0);
    agg.max_possible_points += Number(r.max_possible_points || 0);
    agg.exact_positions += Number(r.exact_positions || 0);
    agg.errors_le_1 += Number(r.errors_le_1 || 0);
    agg.errors_le_2 += Number(r.errors_le_2 || 0);
    agg.champion_correct += Number(r.champion_correct || 0);
    agg.ucl_zone_correct += Number(r.ucl_zone_correct || 0);
    agg.relegation_zone_correct += Number(r.relegation_zone_correct || 0);
    if (r.tournament_code) agg._codes.add(String(r.tournament_code));
    if (r.last_submitted_at != null) {
      agg.last_submitted_at = agg.last_submitted_at == null
        ? Number(r.last_submitted_at)
        : Math.max(agg.last_submitted_at, Number(r.last_submitted_at));
    }
    if (r.scored_at != null) {
      agg.scored_at = agg.scored_at == null
        ? Number(r.scored_at)
        : Math.max(agg.scored_at, Number(r.scored_at));
    }
  }
  return [...byUser.values()].map(({ _codes, ...rest }) => ({ ...rest, scored_leagues_count: _codes.size }));
}

// Empty-state reasons surfaced to the client so the UI never has to guess.
export type LeaderboardEmptyReason = "OFFICIAL_RESULTS_REQUIRED" | "SCORE_RECALC_REQUIRED";

// Per-league: official results must be confirmed/published first; once they are,
// an empty board means the admin has not run the recalculation yet.
export function derivePerLeagueEmptyReason(opts: {
  hasItems: boolean;
  officialConfirmed: boolean;
}): LeaderboardEmptyReason | null {
  if (opts.hasItems) return null;
  return opts.officialConfirmed ? "SCORE_RECALC_REQUIRED" : "OFFICIAL_RESULTS_REQUIRED";
}

// Overall spans all 5 leagues, so it never blocks on a single league's official
// status — an empty board only means no scores exist anywhere yet.
export function deriveOverallEmptyReason(opts: { hasItems: boolean }): LeaderboardEmptyReason | null {
  return opts.hasItems ? null : "SCORE_RECALC_REQUIRED";
}

export type LeaderboardMyRank = {
  rank: number;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  gap_to_leader: number;
};

export type RankedLeaderboard<T extends RankableLeaderboardRow> = {
  sorted: T[];
  total: number;
  /** Page slice with absolute (global) 1-based ranks attached. */
  page: Array<{ row: T; rank: number }>;
  myRank: LeaderboardMyRank | null;
  pagination: { limit: number; offset: number; has_more: boolean };
  /** Latest scored_at across all rows, or null when empty. */
  updatedAt: number | null;
};

// Minimal shape rankAndPaginate needs; both top-5 and eurocup rows satisfy it.
export type RankableLeaderboardRow = {
  user_id: number;
  total_points: number;
  max_possible_points: number;
  scored_at?: number | null;
};

// Sort the full set (so ranks/my_rank are global), then slice the requested page.
export function rankAndPaginate<T extends RankableLeaderboardRow>(
  rows: T[],
  comparator: (a: T, b: T) => number,
  opts: { limit?: number; offset?: number; currentUserId?: number | null },
): RankedLeaderboard<T> {
  const limit = clampLeaderboardLimit(opts.limit ?? LEADERBOARD_DEFAULT_LIMIT);
  const offset = normalizeLeaderboardOffset(opts.offset ?? 0);
  const currentUserId = opts.currentUserId ?? null;

  const sorted = [...rows].sort(comparator);
  const total = sorted.length;
  const leader = sorted[0] || null;

  let myRank: LeaderboardMyRank | null = null;
  if (currentUserId != null) {
    const idx = sorted.findIndex((r) => Number(r.user_id) === Number(currentUserId));
    if (idx >= 0) {
      const me = sorted[idx];
      myRank = {
        rank: idx + 1,
        total_points: me.total_points,
        max_possible_points: me.max_possible_points,
        points_pct: leaderboardPointsPct(me.total_points, me.max_possible_points),
        gap_to_leader: leader ? Math.max(0, leader.total_points - me.total_points) : 0,
      };
    }
  }

  const page = sorted.slice(offset, offset + limit).map((row, i) => ({ row, rank: offset + i + 1 }));

  let updatedAt: number | null = null;
  for (const r of sorted) {
    const s = r.scored_at == null ? null : Number(r.scored_at);
    if (s != null && (updatedAt == null || s > updatedAt)) updatedAt = s;
  }

  return {
    sorted,
    total,
    page,
    myRank,
    pagination: { limit, offset, has_more: offset + limit < total },
    updatedAt,
  };
}
