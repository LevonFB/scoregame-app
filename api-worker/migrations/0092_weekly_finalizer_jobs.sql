-- Stage 6 — additive migration for the weekly finalizer V2 job model.
-- Stage 15: renumbered 0090 → 0092 to resolve a number collision with the
-- pre-existing 0090_weekly_challenge_task_claims.sql / 0091. Never applied yet.
--
-- SAFETY: additive only. CREATE TABLE IF NOT EXISTS + indexes. No ALTER of
-- existing tables, no data changes, no destructive ops. NOT applied this stage.
-- The job_key PRIMARY KEY provides the atomic single-owner lock; reward/snapshot
-- idempotency stays in the existing finalizeWeeklyPeriod (weekly_finalizations
-- ON CONFLICT + replaceWeeklyLeagueSnapshots + syncWeeklyRankingRewards).
--
-- Data impact: one new bookkeeping table for finalizer runs. Aggregate counters
-- + status only — no user payloads, no PII, no error stacks.

CREATE TABLE IF NOT EXISTS weekly_finalizer_jobs (
  job_key           TEXT PRIMARY KEY,          -- weekly-finalizer:<season>:<weekKey>
  season_id         INTEGER,
  week_key          TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|running|completed|failed
  run_id            TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  started_at        INTEGER,
  heartbeat_at      INTEGER,
  completed_at      INTEGER,
  failed_at         INTEGER,
  last_error_code   TEXT,
  finalized_periods INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER,
  updated_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wfj_status ON weekly_finalizer_jobs(status);
CREATE INDEX IF NOT EXISTS idx_wfj_season_week ON weekly_finalizer_jobs(season_id, week_key);
