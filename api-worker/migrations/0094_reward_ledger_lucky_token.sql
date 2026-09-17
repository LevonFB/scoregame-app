-- 0094_reward_ledger_lucky_token.sql
-- BUGFIX (Stage 3, audit finding C-1): allow 'lucky_token' as a reward_ledger reward_type.
--
-- ROOT CAUSE: backend + admin already support granting Жетоны (lucky_token) as a task
-- reward, but reward_ledger.reward_type CHECK was never widened past
-- ('stars','balls','case'). Two broken paths result:
--   * Season Predictions task claim -> grantBracketReward() uses INSERT OR IGNORE, so the
--     CHECK violation is SILENTLY ignored: 0 rows inserted, grantLuckyTokens() never runs,
--     the user loses the reward with NO error and the claim is marked granted.
--   * Weekly Challenge task claim -> weeklyChallengeTaskClaims.ts uses a plain INSERT inside
--     db.batch(): the CHECK violation THROWS, the whole atomic batch rolls back, and the
--     claim fails (WEEKLY_TASK_CLAIM_INCOMPLETE) for every user with that task.
-- Reproduced at SQL level against the final schema (see docs/economy-verification.md §3).
--
-- WHY A FULL TABLE REBUILD (not ALTER): SQLite cannot ALTER an existing CHECK constraint.
-- The only safe way to widen the allowed reward_type set is to recreate the table and copy
-- every row 1:1. This mirrors the established pattern used for source_type in migrations
-- 0077 and 0080.
--
-- DATA IMPACT: reward_ledger rows are copied 1:1 with ids, statuses, timestamps, unique_key,
-- metadata_json, granted_by/revoked_by all preserved. NO reward is granted, revoked, or
-- modified. The ONLY behavioural change is that reward_type='lucky_token' is now accepted.
-- The UNIQUE(unique_key) constraint and idx_reward_ledger_user index are recreated.
-- Idempotent-friendly: uses IF NOT EXISTS for the staging table and the index.
--
-- ROLLBACK: rebuild the table with the previous CHECK (without 'lucky_token') — only safe if
-- no lucky_token rows exist yet.
--
-- FAIL-CLOSED: the staging table is created WITHOUT "IF NOT EXISTS" on purpose. A pre-existing
-- `reward_ledger_new` is an unexpected/dirty state (e.g. a previously interrupted run). In that
-- case this CREATE TABLE errors out BEFORE the destructive DROP/RENAME, so the live
-- `reward_ledger` and its data are left fully intact. We deliberately do NOT add
-- `DROP TABLE IF EXISTS reward_ledger_new` — the migration must not silently delete an
-- unexpected table; an operator must inspect and resolve the dirty state manually.

CREATE TABLE reward_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task','season_prediction_task')),
  source_id TEXT,
  unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case','lucky_token')),
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
