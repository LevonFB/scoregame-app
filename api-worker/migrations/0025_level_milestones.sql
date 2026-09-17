-- 0025_level_milestones.sql
-- Level milestone seasonal tasks + gold avatar frame

----------------------------------------------------------------------
-- 1) Add gold_avatar_frame to user_season_progress
----------------------------------------------------------------------
ALTER TABLE user_season_progress ADD COLUMN gold_avatar_frame INTEGER NOT NULL DEFAULT 0;

----------------------------------------------------------------------
-- 2) Seed level milestone tasks into tasks_catalog
--    Using progress_kind='counter' (CHECK constraint doesn't include 'level')
--    These are identified by task_key LIKE 'level_%' in code
----------------------------------------------------------------------
INSERT OR IGNORE INTO tasks_catalog (task_key, task_type, scope, emoji, title, description, reward_stars, progress_target, progress_kind, reset_scope, phase, league_only, rarity, sort_order) VALUES
  ('level_5',  'seasonal', 'global', '⭐',  'Уровень 5',  'Достигни 5 уровень в этом сезоне',   3, 5,  'counter', 'season', 'scores_updated', 0, 'common', 40),
  ('level_10', 'seasonal', 'global', '⭐',  'Уровень 10', 'Достигни 10 уровень в этом сезоне',  5, 10, 'counter', 'season', 'scores_updated', 0, 'common', 41),
  ('level_20', 'seasonal', 'global', '⭐',  'Уровень 20', 'Достигни 20 уровень в этом сезоне',  8, 20, 'counter', 'season', 'scores_updated', 0, 'rare',   42),
  ('level_25', 'seasonal', 'global', '⭐',  'Уровень 25', 'Достигни 25 уровень в этом сезоне', 10, 25, 'counter', 'season', 'scores_updated', 0, 'rare',   43),
  ('level_30', 'seasonal', 'global', '🌟', 'Уровень 30', 'Достигни 30 уровень в этом сезоне', 12, 30, 'counter', 'season', 'scores_updated', 0, 'epic',   44),
  ('level_35', 'seasonal', 'global', '🌟', 'Уровень 35', 'Достигни 35 уровень в этом сезоне', 15, 35, 'counter', 'season', 'scores_updated', 0, 'epic',   45),
  ('level_40', 'seasonal', 'global', '👑',  'Уровень 40', 'Достигни максимальный уровень сезона', 0, 40, 'counter', 'season', 'scores_updated', 0, 'epic', 46);

----------------------------------------------------------------------
-- 3) Backfill: mark completed milestones for existing users
----------------------------------------------------------------------
-- For each user with level >= milestone, insert into user_task_progress
INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_5', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 5;

INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_10', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 10;

INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_20', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 20;

INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_25', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 25;

INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_30', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 30;

INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_35', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 35;

INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT usp.user_id, usp.season_number, 'level_40', 'season', usp.level,
       CAST(strftime('%s','now') AS INTEGER) * 1000, 1
FROM user_season_progress usp WHERE usp.level >= 40;

----------------------------------------------------------------------
-- 4) Backfill stars_ledger for milestone rewards (idempotent)
----------------------------------------------------------------------
INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT usp.user_id, usp.season_number, 'seasonal_task', 'level_5', 'season', 3,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM user_season_progress usp WHERE usp.level >= 5;

INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT usp.user_id, usp.season_number, 'seasonal_task', 'level_10', 'season', 5,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM user_season_progress usp WHERE usp.level >= 10;

INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT usp.user_id, usp.season_number, 'seasonal_task', 'level_20', 'season', 8,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM user_season_progress usp WHERE usp.level >= 20;

INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT usp.user_id, usp.season_number, 'seasonal_task', 'level_25', 'season', 10,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM user_season_progress usp WHERE usp.level >= 25;

INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT usp.user_id, usp.season_number, 'seasonal_task', 'level_30', 'season', 12,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM user_season_progress usp WHERE usp.level >= 30;

INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT usp.user_id, usp.season_number, 'seasonal_task', 'level_35', 'season', 15,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM user_season_progress usp WHERE usp.level >= 35;

----------------------------------------------------------------------
-- 5) Gold frame for level 40 users
----------------------------------------------------------------------
UPDATE user_season_progress SET gold_avatar_frame = 1 WHERE level >= 40;

----------------------------------------------------------------------
-- 6) Recalculate stars for users who got milestone bonuses
--    Total bonus stars: 3+5+8+10+12+15 = 53 for all milestones
--    We need to add these to user_season_progress.stars
----------------------------------------------------------------------
-- Add milestone bonus stars that weren't counted before
UPDATE user_season_progress SET stars = stars + 3 WHERE level >= 5;
UPDATE user_season_progress SET stars = stars + 5 WHERE level >= 10;
UPDATE user_season_progress SET stars = stars + 8 WHERE level >= 20;
UPDATE user_season_progress SET stars = stars + 10 WHERE level >= 25;
UPDATE user_season_progress SET stars = stars + 12 WHERE level >= 30;
UPDATE user_season_progress SET stars = stars + 15 WHERE level >= 35;
