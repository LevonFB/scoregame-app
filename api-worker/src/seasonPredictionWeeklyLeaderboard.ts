// seasonPredictionWeeklyLeaderboard.ts
// Pure ranking + pagination for the public "Вызов недели" leaderboard (W5). No I/O.
// Read-only: never grants rewards. Built from season_prediction_weekly_challenge_scores.

export type WeeklyLeaderboardRow = {
  user_id: number;
  display_name: string;
  avatar_url: string | null;
  total_points: number;
  max_points: number;
  points_pct: number;
  submitted_at: number | null;
  scored_at: number | null;
};

export type RankedWeeklyLeaderboardRow = WeeklyLeaderboardRow & { rank: number };

// Tie policy: total_points DESC, points_pct DESC, submitted_at ASC (nulls last),
// user_id ASC. The first two decide the rank; the rest only make ordering stable.
function compareWeeklyLeaderboard(a: WeeklyLeaderboardRow, b: WeeklyLeaderboardRow): number {
  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  if (b.points_pct !== a.points_pct) return b.points_pct - a.points_pct;
  const sa = a.submitted_at == null ? Number.POSITIVE_INFINITY : Number(a.submitted_at);
  const sb = b.submitted_at == null ? Number.POSITIVE_INFINITY : Number(b.submitted_at);
  if (sa !== sb) return sa - sb;
  return a.user_id - b.user_id;
}

// Two rows share a rank only when their scored metric is equal (points + pct).
function isWeeklyLeaderboardTie(a: WeeklyLeaderboardRow, b: WeeklyLeaderboardRow): boolean {
  return a.total_points === b.total_points && a.points_pct === b.points_pct;
}

// Competition rank (1, 1, 3): tied rows share the lower rank, the next distinct
// metric skips accordingly. Pure.
export function rankWeeklyLeaderboard(rows: WeeklyLeaderboardRow[]): RankedWeeklyLeaderboardRow[] {
  const sorted = [...(rows || [])].sort(compareWeeklyLeaderboard);
  const out: RankedWeeklyLeaderboardRow[] = [];
  let rank = 0;
  let prev: WeeklyLeaderboardRow | null = null;
  sorted.forEach((row, index) => {
    if (prev === null || !isWeeklyLeaderboardTie(prev, row)) rank = index + 1;
    out.push({ ...row, rank });
    prev = row;
  });
  return out;
}

export type WeeklyLeaderboardPagination = { page: number; limit: number; total: number; pages: number };

export function paginateWeeklyLeaderboard<T>(items: T[], page: number, limit: number): { slice: T[]; pagination: WeeklyLeaderboardPagination } {
  const total = items.length;
  const safeLimit = Math.max(1, Math.floor(limit) || 0);
  const pages = total === 0 ? 0 : Math.ceil(total / safeLimit);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const start = (safePage - 1) * safeLimit;
  return {
    slice: items.slice(start, start + safeLimit),
    pagination: { page: safePage, limit: safeLimit, total, pages },
  };
}

// Find a user's ranked row (their place is valid even when off the current page).
export function findWeeklyLeaderboardEntry(ranked: RankedWeeklyLeaderboardRow[], userId: number): RankedWeeklyLeaderboardRow | null {
  return ranked.find((r) => r.user_id === userId) || null;
}
