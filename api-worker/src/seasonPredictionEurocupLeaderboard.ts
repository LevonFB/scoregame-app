// Stage E4 — read-only eurocup leaderboards (league stage, eurocups_v2).
//
// Pure, DB-free ranking/aggregation logic. Eurocup-specific metrics live inside
// breakdown_json (no dedicated columns), so they are parsed with a safe fallback
// to 0. No score mutation, no recalc, no rewards. Reuses rankAndPaginate +
// empty-reason helpers from seasonPredictionLeaderboard.ts.

export const EUROCUP_LEADERBOARD_CODES = ["UCL", "UEL", "UECL"] as const;

export type EurocupMetricRow = {
  user_id: number;
  total_points: number;
  max_possible_points: number;
  top8_correct: number;
  playoff_9_24_correct: number;
  top24_correct: number;
  bonus_points: number;
  scored_cups_count?: number; // overall only
  last_submitted_at: number | null;
  scored_at?: number | null;
};

export type RawEurocupScoreRow = EurocupMetricRow & { tournament_code: string };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Pull eurocup metrics out of breakdown_json.summary / breakdown_json.bonuses.
// Tolerates old/broken/missing breakdown — every metric falls back to 0.
export function extractEurocupMetricsFromBreakdown(breakdownJson: unknown): {
  top8_correct: number;
  playoff_9_24_correct: number;
  top24_correct: number;
  bonus_points: number;
} {
  const bd = breakdownJson && typeof breakdownJson === "object" ? (breakdownJson as Record<string, unknown>) : {};
  const summary = bd.summary && typeof bd.summary === "object" ? (bd.summary as Record<string, unknown>) : {};
  const bonuses = Array.isArray(bd.bonuses) ? (bd.bonuses as Array<Record<string, unknown>>) : [];
  const bonusPoints = bonuses.reduce((acc, b) => acc + (b && b.earned ? num(b.points) : 0), 0);
  return {
    top8_correct: num(summary.top8_correct),
    playoff_9_24_correct: num(summary.playoff_9_24_correct),
    top24_correct: num(summary.top24_correct),
    bonus_points: bonusPoints,
  };
}

function submittedAscTiebreak(a: EurocupMetricRow, b: EurocupMetricRow): number {
  const av = a.last_submitted_at == null ? Number.POSITIVE_INFINITY : Number(a.last_submitted_at);
  const bv = b.last_submitted_at == null ? Number.POSITIVE_INFINITY : Number(b.last_submitted_at);
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

// Per-cup: total_points → top24_correct → top8_correct → playoff_9_24_correct →
// bonus_points → last_submitted_at ASC (null last) → user_id ASC.
export function compareEurocupPerCup(a: EurocupMetricRow, b: EurocupMetricRow): number {
  return (
    b.total_points - a.total_points
    || b.top24_correct - a.top24_correct
    || b.top8_correct - a.top8_correct
    || b.playoff_9_24_correct - a.playoff_9_24_correct
    || b.bonus_points - a.bonus_points
    || submittedAscTiebreak(a, b)
    || a.user_id - b.user_id
  );
}

// Overall: same accuracy chain, then scored_cups_count DESC, then time, then user.
export function compareEurocupOverall(a: EurocupMetricRow, b: EurocupMetricRow): number {
  return (
    b.total_points - a.total_points
    || b.top24_correct - a.top24_correct
    || b.top8_correct - a.top8_correct
    || b.playoff_9_24_correct - a.playoff_9_24_correct
    || b.bonus_points - a.bonus_points
    || (b.scored_cups_count || 0) - (a.scored_cups_count || 0)
    || submittedAscTiebreak(a, b)
    || a.user_id - b.user_id
  );
}

// Aggregate per-cup score rows into one overall row per user. Works for ANY
// subset of the 3 cups: one cup scored → scored_cups_count = 1.
export function aggregateEurocupOverall(rows: RawEurocupScoreRow[]): EurocupMetricRow[] {
  const byUser = new Map<number, EurocupMetricRow & { _codes: Set<string> }>();
  for (const r of rows) {
    const userId = Number(r.user_id);
    let agg = byUser.get(userId);
    if (!agg) {
      agg = {
        user_id: userId,
        total_points: 0,
        max_possible_points: 0,
        top8_correct: 0,
        playoff_9_24_correct: 0,
        top24_correct: 0,
        bonus_points: 0,
        scored_cups_count: 0,
        last_submitted_at: null,
        scored_at: null,
        _codes: new Set<string>(),
      };
      byUser.set(userId, agg);
    }
    agg.total_points += num(r.total_points);
    agg.max_possible_points += num(r.max_possible_points);
    agg.top8_correct += num(r.top8_correct);
    agg.playoff_9_24_correct += num(r.playoff_9_24_correct);
    agg.top24_correct += num(r.top24_correct);
    agg.bonus_points += num(r.bonus_points);
    if (r.tournament_code) agg._codes.add(String(r.tournament_code));
    if (r.last_submitted_at != null) {
      agg.last_submitted_at = agg.last_submitted_at == null
        ? Number(r.last_submitted_at)
        : Math.max(agg.last_submitted_at, Number(r.last_submitted_at));
    }
    if (r.scored_at != null) {
      agg.scored_at = agg.scored_at == null ? Number(r.scored_at) : Math.max(agg.scored_at, Number(r.scored_at));
    }
  }
  return [...byUser.values()].map(({ _codes, ...rest }) => ({ ...rest, scored_cups_count: _codes.size }));
}
