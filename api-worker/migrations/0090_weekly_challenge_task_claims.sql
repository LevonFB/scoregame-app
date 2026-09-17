-- Migration 0090: operation-level idempotency/concurrency guard for Weekly Challenge task claims.
-- Additive only. Does not change reward amounts, task catalog, scoring, or old reward_ledger rows.

CREATE TABLE IF NOT EXISTS weekly_challenge_task_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_challenge_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  lock_token TEXT,
  reward_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  completed_at INTEGER,
  UNIQUE(weekly_challenge_id, user_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_wctc_user_status
  ON weekly_challenge_task_claims(user_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_wctc_challenge_user
  ON weekly_challenge_task_claims(weekly_challenge_id, user_id);
