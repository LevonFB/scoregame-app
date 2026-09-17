export type WeeklyChallengeArchiveCandidateRow = {
  id: number;
  deadline_at?: number | null;
  [key: string]: unknown;
};

export type WeeklyChallengeArchiveCandidatePage<T extends WeeklyChallengeArchiveCandidateRow = WeeklyChallengeArchiveCandidateRow> = {
  rows: T[];
  nextCursor: string | null;
  limit: number;
};

export function normalizeWeeklyArchiveLimit(input: unknown): number {
  const value = Number(input || 50);
  return Math.max(1, Math.min(100, Number.isFinite(value) ? Math.floor(value) : 50));
}

export function parseWeeklyArchiveCursor(cursor: string | null | undefined): { deadline: number; id: number } | null {
  const match = cursor?.match(/^(-?\d+):(\d+)$/);
  if (!match) return null;
  const deadline = Number(match[1]);
  const id = Number(match[2]);
  if (!Number.isFinite(deadline) || !Number.isFinite(id)) return null;
  return { deadline, id };
}

export async function listWeeklyChallengeArchiveCandidates<T extends WeeklyChallengeArchiveCandidateRow = WeeklyChallengeArchiveCandidateRow>(
  db: D1Database,
  params: {
    seasonId: number;
    userId: number;
    currentChallengeId?: number | null;
    limit?: number;
    cursor?: string | null;
  },
): Promise<WeeklyChallengeArchiveCandidatePage<T>> {
  const limit = normalizeWeeklyArchiveLimit(params.limit);
  const parsedCursor = parseWeeklyArchiveCursor(params.cursor);
  const whereParts = [
    "c.season_prediction_season_id = ?",
    "c.status <> 'draft'",
  ];
  const binds: Array<number | string> = [params.userId, params.seasonId];
  if (params.currentChallengeId != null) {
    whereParts.push("c.id <> ?");
    binds.push(params.currentChallengeId);
  }
  if (parsedCursor) {
    whereParts.push("(COALESCE(c.deadline_at, 0) < ? OR (COALESCE(c.deadline_at, 0) = ? AND c.id < ?))");
    binds.push(parsedCursor.deadline, parsedCursor.deadline, parsedCursor.id);
  }
  binds.push(limit + 1);

  const rowsRes = await db.prepare(`
    SELECT DISTINCT c.*
    FROM season_prediction_weekly_challenges c
    JOIN season_prediction_weekly_challenge_entries e
      ON e.weekly_challenge_id = c.id
     AND e.user_id = ?
    WHERE ${whereParts.join(" AND ")}
    ORDER BY COALESCE(c.deadline_at, 0) DESC, c.id DESC
    LIMIT ?
  `).bind(...binds).all();

  const fetched = (rowsRes.results || []) as T[];
  const rows = fetched.slice(0, limit);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  return {
    rows,
    nextCursor: fetched.length > limit && last ? `${Number(last.deadline_at || 0)}:${Number(last.id)}` : null,
    limit,
  };
}
