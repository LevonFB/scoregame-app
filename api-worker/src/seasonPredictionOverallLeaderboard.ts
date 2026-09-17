// Stage E5 — read-only combined season leaderboard (top-5 leagues + eurocups).
//
// Pure, DB-free aggregation/sorting. Sums already-calculated scores from
// season_prediction_user_scores; no scoring change, no recalc, no rewards,
// no snapshots. Reuses rankAndPaginate from seasonPredictionLeaderboard.ts.

import { LEADERBOARD_TOP_LEAGUE_CODES } from "./seasonPredictionLeaderboard";
import { EUROCUP_LEADERBOARD_CODES } from "./seasonPredictionEurocupLeaderboard";

export const SEASON_OVERALL_FORMULA_VERSION = "season_overall_v1";
export const SEASON_OVERALL_MAX_TOURNAMENTS = LEADERBOARD_TOP_LEAGUE_CODES.length + EUROCUP_LEADERBOARD_CODES.length; // 8

export type SeasonScoreGroup = "top5" | "eurocups";

export function seasonGroupOfCode(code: string): SeasonScoreGroup | null {
  if ((LEADERBOARD_TOP_LEAGUE_CODES as readonly string[]).includes(code)) return "top5";
  if ((EUROCUP_LEADERBOARD_CODES as readonly string[]).includes(code)) return "eurocups";
  return null;
}

export type RawSeasonScoreRow = {
  user_id: number;
  tournament_code: string;
  total_points: number;
  max_possible_points: number;
  last_submitted_at: number | null;
  scored_at: number | null;
};

export type SeasonOverallRow = {
  user_id: number;
  total_points: number;
  max_possible_points: number;
  top5_points: number;
  top5_max_points: number;
  top5_scored_count: number;
  eurocups_points: number;
  eurocups_max_points: number;
  eurocups_scored_count: number;
  scored_total_count: number;
  last_submitted_at: number | null;
  scored_at: number | null;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Aggregate per-tournament score rows into one combined season row per user.
// Works for ANY subset (only top5, only eurocups, or partial coverage of each).
export function aggregateSeasonOverallLeaderboard(rows: RawSeasonScoreRow[]): SeasonOverallRow[] {
  type Acc = SeasonOverallRow & { _top5: Set<string>; _euro: Set<string> };
  const byUser = new Map<number, Acc>();
  for (const r of rows) {
    const group = seasonGroupOfCode(String(r.tournament_code));
    if (!group) continue; // ignore unrelated tournaments (e.g. weekly challenge)
    const userId = Number(r.user_id);
    let agg = byUser.get(userId);
    if (!agg) {
      agg = {
        user_id: userId,
        total_points: 0,
        max_possible_points: 0,
        top5_points: 0,
        top5_max_points: 0,
        top5_scored_count: 0,
        eurocups_points: 0,
        eurocups_max_points: 0,
        eurocups_scored_count: 0,
        scored_total_count: 0,
        last_submitted_at: null,
        scored_at: null,
        _top5: new Set<string>(),
        _euro: new Set<string>(),
      };
      byUser.set(userId, agg);
    }
    const pts = num(r.total_points);
    const max = num(r.max_possible_points);
    if (group === "top5") {
      agg.top5_points += pts;
      agg.top5_max_points += max;
      agg._top5.add(String(r.tournament_code));
    } else {
      agg.eurocups_points += pts;
      agg.eurocups_max_points += max;
      agg._euro.add(String(r.tournament_code));
    }
    if (r.last_submitted_at != null) {
      agg.last_submitted_at = agg.last_submitted_at == null
        ? Number(r.last_submitted_at)
        : Math.max(agg.last_submitted_at, Number(r.last_submitted_at));
    }
    if (r.scored_at != null) {
      agg.scored_at = agg.scored_at == null ? Number(r.scored_at) : Math.max(agg.scored_at, Number(r.scored_at));
    }
  }
  return [...byUser.values()].map(({ _top5, _euro, ...rest }) => {
    const top5_scored_count = _top5.size;
    const eurocups_scored_count = _euro.size;
    return {
      ...rest,
      top5_scored_count,
      eurocups_scored_count,
      total_points: rest.top5_points + rest.eurocups_points,
      max_possible_points: rest.top5_max_points + rest.eurocups_max_points,
      scored_total_count: top5_scored_count + eurocups_scored_count,
    };
  });
}

function submittedAscTiebreak(a: SeasonOverallRow, b: SeasonOverallRow): number {
  const av = a.last_submitted_at == null ? Number.POSITIVE_INFINITY : Number(a.last_submitted_at);
  const bv = b.last_submitted_at == null ? Number.POSITIVE_INFINITY : Number(b.last_submitted_at);
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

// total_points → scored_total_count → top5_points → eurocups_points →
// top5_scored_count → eurocups_scored_count → last_submitted_at ASC → user_id ASC.
export function compareSeasonOverall(a: SeasonOverallRow, b: SeasonOverallRow): number {
  return (
    b.total_points - a.total_points
    || b.scored_total_count - a.scored_total_count
    || b.top5_points - a.top5_points
    || b.eurocups_points - a.eurocups_points
    || b.top5_scored_count - a.top5_scored_count
    || b.eurocups_scored_count - a.eurocups_scored_count
    || submittedAscTiebreak(a, b)
    || a.user_id - b.user_id
  );
}

export function deriveSeasonOverallEmptyReason(hasItems: boolean): "SCORE_RECALC_REQUIRED" | null {
  return hasItems ? null : "SCORE_RECALC_REQUIRED";
}
