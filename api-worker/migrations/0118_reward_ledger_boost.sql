-- 0118_reward_ledger_boost.sql
-- FEATURE: allow 'boost' as a reward_ledger reward_type so the Weekly Challenge result
-- tiers can grant paid boosts (extra_joker / double_chance) idempotently via the shared
-- reward_ledger, exactly like stars/balls/case/lucky_token.
--
-- HOW BOOSTS ARE RECORDED: reward_type='boost', case_type reused to hold the boost subtype
-- ('extra_joker' | 'double_chance'), amount = number of boosts granted. Each granted boost
-- is one row in user_boosts (status='available'); the ledger row is the idempotency anchor
-- (unique_key = "...:boost:{boost_type}"), so a replayed claim inserts nothing.
--
-- WHY A FULL TABLE REBUILD (not ALTER): SQLite cannot ALTER an existing CHECK constraint.
-- The only safe way to widen the allowed reward_type set is to recreate the table and copy
-- every row 1:1. This mirrors migrations 0077, 0080 and 0094.
--
-- DATA IMPACT: reward_ledger rows are copied 1:1 with ids, statuses, timestamps, unique_key,
-- metadata_json, granted_by/revoked_by all preserved. NO reward is granted, revoked, or
-- modified. The ONLY behavioural change is that reward_type='boost' is now accepted.
-- The UNIQUE(unique_key) constraint and idx_reward_ledger_user index are recreated.
--
-- ROLLBACK: rebuild the table with the previous CHECK (without 'boost') — only safe if no
-- boost rows exist yet.
--
-- FAIL-CLOSED: the staging table is created WITHOUT "IF NOT EXISTS" on purpose. A pre-existing
-- `reward_ledger_new` is an unexpected/dirty state (e.g. a previously interrupted run). In that
-- case this CREATE TABLE errors out BEFORE the destructive DROP/RENAME, so the live
-- `reward_ledger` and its data are left fully intact.

CREATE TABLE reward_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin','weekly_challenge_task','season_prediction_task')),
  source_id TEXT,
  unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case','lucky_token','boost')),
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
