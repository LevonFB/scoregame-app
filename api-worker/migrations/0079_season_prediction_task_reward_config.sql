-- 0079_season_prediction_task_reward_config.sql
-- Stage E10.2: per-task reward configuration for SEASON-PREDICTION tasks
-- (top-5 + eurocups: league stage / ties / bracket / results).
--
-- Admin-managed, NO auto-distribution. The table starts EMPTY; effective defaults
-- live in code (seasonPredictionTaskRewards.ts) and are applied by the API when an
-- admin has not saved a custom config for a task yet. Rewards are granted ONLY by
-- the explicit per-user claim endpoint via the shared reward_ledger (idempotent),
-- never on recalc/scoring. This migration adds NO economy columns.
--
-- Global config (task_key PRIMARY KEY, not per-season): a single reward setup
-- applies across seasons; per-season de-dup of claims is handled by the claim
-- unique_key (season_prediction_task_claim:{season_id}:{user_id}:{task_key}).

CREATE TABLE IF NOT EXISTS season_prediction_task_reward_config (
  task_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  balls INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  case_type TEXT,
  case_count INTEGER NOT NULL DEFAULT 0,
  title_override TEXT,
  admin_note TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_by INTEGER,
  CHECK (balls >= 0),
  CHECK (stars >= 0),
  CHECK (case_count >= 0),
  CHECK (case_type IS NOT NULL OR case_count = 0)
);

CREATE INDEX IF NOT EXISTS idx_sptrc_enabled
  ON season_prediction_task_reward_config(enabled);
