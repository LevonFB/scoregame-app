// Stage 6 — generic atomic single-owner job lock over a D1 table that has a
// unique `job_key` PRIMARY KEY plus the standard lifecycle columns. Reused by the
// weekly finalizer (and shaped like the Stage 3 daily-case backfill claim).
//
// Correctness: claim is a single INSERT ... ON CONFLICT DO UPDATE WHERE ... so
// exactly one caller wins. Finalize/heartbeat use `WHERE job_key=? AND run_id=?`
// so a stale-recovered owner cannot overwrite a newer run.
//
// `table` is always a hard-coded constant from our code (never user input).

export interface JobRow {
  job_key: string;
  status: string;
  run_id?: string | null;
  heartbeat_at?: number | null;
  [k: string]: any;
}

export async function getJob(db: D1Database, table: string, jobKey: string): Promise<JobRow | null> {
  try {
    const row = await db.prepare(`SELECT * FROM ${table} WHERE job_key = ?`).bind(jobKey).first() as any;
    return row || null;
  } catch {
    return null; // table absent (migration not applied) → behave as "no job"
  }
}

/**
 * Atomically claim `jobKey` in `table`. `extra` carries table-specific columns
 * (e.g. season_id, week_key) set on insert. Returns whether we own it now.
 */
export async function claimJob(
  db: D1Database,
  table: string,
  jobKey: string,
  runId: string,
  nowMs: number,
  staleMs: number,
  extra: Record<string, string | number> = {}
): Promise<{ claimed: boolean; decision: string }> {
  const extraCols = Object.keys(extra);
  const colSql = extraCols.length ? ", " + extraCols.join(", ") : "";
  const valSql = extraCols.length ? ", " + extraCols.map(() => "?").join(", ") : "";
  const staleThreshold = nowMs - staleMs;
  const res = await db.prepare(`
    INSERT INTO ${table} (job_key, status, run_id, attempts, started_at, heartbeat_at, created_at, updated_at${colSql})
    VALUES (?, 'running', ?, 1, ?, ?, ?, ?${valSql})
    ON CONFLICT(job_key) DO UPDATE SET
      status='running', run_id=excluded.run_id, attempts=${table}.attempts+1,
      started_at=excluded.started_at, heartbeat_at=excluded.heartbeat_at, updated_at=excluded.updated_at,
      failed_at=NULL, last_error_code=NULL
    WHERE ${table}.status IN ('pending','failed')
       OR (${table}.status='running' AND COALESCE(${table}.heartbeat_at,0) < ?)
  `).bind(jobKey, runId, nowMs, nowMs, nowMs, nowMs, ...extraCols.map((k) => extra[k]), staleThreshold).run();
  const changes = res.meta?.changes ?? 0;
  if (changes > 0) {
    const row = await getJob(db, table, jobKey);
    if (row && String(row.run_id) === runId) return { claimed: true, decision: "claimed" };
    return { claimed: false, decision: "lost_race" };
  }
  const row = await getJob(db, table, jobKey);
  return { claimed: false, decision: row?.status === "completed" ? "already_completed" : "already_running" };
}
