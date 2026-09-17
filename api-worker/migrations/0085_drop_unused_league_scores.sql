-- Remove unused legacy league leaderboard cache.
-- The table contains no data and has been replaced by league_day_stats
-- and weekly/season league standings snapshots.

DROP INDEX IF EXISTS idx_league_scores_period;
DROP TABLE IF EXISTS league_scores;
