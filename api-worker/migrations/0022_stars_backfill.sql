-- 0022_stars_backfill.sql
-- Backfill: Award stars for achievements already confirmed but stars not yet credited
-- This is idempotent: only inserts if user_season_progress doesn't exist for that user+season,
-- or increments stars if it does.

-- Step 1: Compute total stars owed per user from confirmed achievements
-- Step 2: Upsert into user_season_progress

-- We use season_number=2 (current season from app_settings)

INSERT INTO user_season_progress (user_id, season_number, stars, level)
SELECT
  ua.user_id,
  2 AS season_number,
  SUM(a.stars_reward) AS total_stars,
  1 AS level
FROM user_achievements ua
JOIN achievements a ON a.id = ua.achievement_id
WHERE ua.state = 'confirmed'
  AND a.stars_reward > 0
GROUP BY ua.user_id
ON CONFLICT(user_id, season_number) DO UPDATE SET
  stars = user_season_progress.stars + excluded.stars;
