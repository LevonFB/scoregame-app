-- Migration 0026: Balls backfill + Shop system tables
-- =================================================

-- 0. users.balls — the ball balance itself. Production got this column outside
-- migrations, which made step 3 below fail on a from-scratch build. Added 2026-08-05;
-- production records 0026 as applied, so this ALTER only runs on a fresh database.
ALTER TABLE users ADD COLUMN balls INTEGER NOT NULL DEFAULT 0;

-- 1. Create balls_ledger for idempotent tracking of balls awards
CREATE TABLE IF NOT EXISTS balls_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  season_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  instance_key TEXT NOT NULL DEFAULT 'season',
  balls INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'task_reward',  -- 'task_reward', 'task_reward_backfill', 'purchase_refund'
  created_at INTEGER NOT NULL
);

-- Unique constraint to prevent double ball awards per task per user per season
CREATE UNIQUE INDEX IF NOT EXISTS idx_balls_ledger_unique
  ON balls_ledger(user_id, season_id, task_key, instance_key);

-- 2. Backfill balls for already-completed tasks in current season (season 2)
-- Source of truth: user_task_progress WHERE season_id=2 AND reward_granted=1
-- Only tasks with reward_balls > 0 in tasks_catalog
-- INSERT OR IGNORE ensures idempotency (unique index prevents duplicates)

-- NOTE: reward_balls was added to tasks_catalog outside of migrations on production.
-- On a fresh DB the column does not exist yet, but user_task_progress is also empty,
-- so this INSERT would produce 0 rows regardless. We use 0 as a safe placeholder;
-- the production backfill already ran correctly when this migration was first applied.
INSERT OR IGNORE INTO balls_ledger (user_id, season_id, task_key, instance_key, balls, source, created_at)
SELECT
  utp.user_id,
  utp.season_id,
  utp.task_key,
  utp.instance_key,
  0,
  'task_reward_backfill',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM user_task_progress utp
JOIN tasks_catalog tc ON tc.task_key = utp.task_key
WHERE utp.season_id = (SELECT COALESCE(CAST(json_extract(value_json, '$.number') AS INTEGER), 2) FROM app_settings WHERE key='season')
  AND utp.reward_granted = 1;

-- 3. Update users.balls balance based on backfilled amounts
-- This adds the total backfill amount that was just inserted
UPDATE users SET balls = balls + COALESCE((
  SELECT SUM(bl.balls)
  FROM balls_ledger bl
  WHERE bl.user_id = users.id
    AND bl.source = 'task_reward_backfill'
    AND bl.season_id = (SELECT COALESCE(CAST(json_extract(value_json, '$.number') AS INTEGER), 2) FROM app_settings WHERE key='season')
), 0)
WHERE id IN (
  SELECT DISTINCT user_id FROM balls_ledger
  WHERE source = 'task_reward_backfill'
    AND season_id = (SELECT COALESCE(CAST(json_extract(value_json, '$.number') AS INTEGER), 2) FROM app_settings WHERE key='season')
);

-- =================================================
-- SHOP SYSTEM TABLES
-- =================================================

-- 4. Purchase history for all shop transactions
CREATE TABLE IF NOT EXISTS purchase_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,       -- 'extra_joker', 'double_chance', 'extra_league'
  balls_cost INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 5. User boost inventory (purchased but not yet used boosts)
CREATE TABLE IF NOT EXISTS user_boosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  boost_type TEXT NOT NULL,      -- 'extra_joker', 'double_chance'
  status TEXT NOT NULL DEFAULT 'available',  -- 'available', 'used', 'refunded'
  purchased_at INTEGER NOT NULL,
  used_at INTEGER,
  used_on_day TEXT,              -- game day when used (YYYY-MM-DD)
  used_on_match_id TEXT          -- match_id for double_chance
);

-- 6. Boost usage tracking per day (enforces 1 paid boost per day)
CREATE TABLE IF NOT EXISTS boost_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,             -- game day (YYYY-MM-DD)
  boost_type TEXT NOT NULL,     -- 'extra_joker' or 'double_chance'
  boost_id INTEGER NOT NULL,    -- references user_boosts.id
  match_id TEXT,                -- for double_chance: which match
  dc_variant TEXT,              -- for double_chance: '1X', 'X2', '12'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)    -- only 1 paid boost per user per day
);

-- 7. Extra league slots for users
-- We'll add a column to users table
ALTER TABLE users ADD COLUMN extra_league_slots INTEGER NOT NULL DEFAULT 0;

-- 8. Double chance data on picks
-- Add double_chance column to picks to store the variant
ALTER TABLE picks ADD COLUMN double_chance TEXT DEFAULT NULL;
-- double_chance values: NULL (no boost), '1X', 'X2', '12'
