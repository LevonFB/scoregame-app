-- 0077_reward_ledger_weekly_source.sql
-- Stage W2: allow 'weekly_challenge_task' as a reward_ledger source_type so weekly
-- challenge task claims can use the shared idempotent ledger (same dedup model as
-- bracket rewards). SQLite cannot ALTER a CHECK constraint, so the table is rebuilt
-- preserving every existing row, id, and the user index.
--
-- Data impact: reward_ledger rows are copied 1:1 (ids preserved). No rewards are
-- granted, revoked, or modified. Rollback: rebuild the table with the original
-- CHECK (without 'weekly_challenge_task') — only safe if no weekly rows exist yet.

CREATE TABLE IF NOT EXISTS reward_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task')),
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
