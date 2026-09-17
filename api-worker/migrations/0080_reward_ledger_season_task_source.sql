-- 0080_reward_ledger_season_task_source.sql
-- E10.2 bugfix: allow 'season_prediction_task' as a reward_ledger source_type.
--
-- ROOT CAUSE: the season-prediction task CLAIM grants rewards via the shared
-- grantBracketReward(... source_type='season_prediction_task' ...) using
-- `INSERT OR IGNORE`. The previous CHECK constraint (migration 0077) only allowed
-- bracket/manual/weekly sources, so every season-task ledger insert violated the
-- CHECK and was SILENTLY ignored by OR IGNORE — no ledger row, no balance change,
-- no claim recorded, yet the endpoint still reported success. This rebuilds the
-- table adding 'season_prediction_task' to the allowed set.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt preserving every
-- existing row, id, and the user index. Data impact: reward_ledger rows are copied
-- 1:1 (ids preserved). No rewards are granted, revoked, or modified.

CREATE TABLE IF NOT EXISTS reward_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task','season_prediction_task')),
  source_id TEXT,
  unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case')),
  amount INTEGER NOT NULL DEFAULT 0,
  case_type TEXT,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  granted_by INTEGER,
  revoked_at INTEGER,
  revoked_by INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO reward_ledger_new
  (id, user_id, source_type, source_id, unique_key, reward_type, amount, case_type,
   status, granted_at, granted_by, revoked_at, revoked_by, metadata_json)
SELECT
  id, user_id, source_type, source_id, unique_key, reward_type, amount, case_type,
  status, granted_at, granted_by, revoked_at, revoked_by, metadata_json
FROM reward_ledger;

DROP TABLE reward_ledger;

ALTER TABLE reward_ledger_new RENAME TO reward_ledger;

CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC);
