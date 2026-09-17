-- Stage 3 — additive migration for the daily-case backfill V2 job model.
--
-- SAFETY: additive only. CREATE TABLE IF NOT EXISTS + indexes. No ALTER of
-- existing tables, no data changes, no destructive ops. NOT applied in this stage
-- (no `wrangler d1 migrations apply`). The job_key PRIMARY KEY provides the atomic
-- single-owner lock; per-case idempotency is enforced separately by
-- daily_cases.earned (compare-and-set in transferDailyCaseToInventory).
--
-- Data impact: introduces one new bookkeeping table for backfill runs. It stores
-- only aggregate counters and status — NO user payloads, NO PII, NO error stacks.

CREATE TABLE IF NOT EXISTS daily_case_backfill_jobs (
  job_key                TEXT PRIMARY KEY,           -- e.g. daily-case-backfill:2026-06-14
  matchday_key           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending', -- pending|running|completed|failed
  run_id                 TEXT,
  attempts               INTEGER NOT NULL DEFAULT 0,
  started_at             INTEGER,
  heartbeat_at           INTEGER,
  completed_at           INTEGER,
  failed_at              INTEGER,
  last_error_code        TEXT,
  -- Stage 3.1: renamed from checked_users — the eligibility query materializes
  -- only eligible users, so this counts processed-eligible, not all candidates.
  processed_eligible_users INTEGER NOT NULL DEFAULT 0,
  eligible_users         INTEGER NOT NULL DEFAULT 0,
  restored_cases         INTEGER NOT NULL DEFAULT 0,
  skipped_existing_cases INTEGER NOT NULL DEFAULT 0,
  failed_items           INTEGER NOT NULL DEFAULT 0,
  cursor_user_id         INTEGER NOT NULL DEFAULT 0,
  dry_run                INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER,
  updated_at             INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dcbj_status ON daily_case_backfill_jobs(status);
CREATE INDEX IF NOT EXISTS idx_dcbj_matchday ON daily_case_backfill_jobs(matchday_key);
