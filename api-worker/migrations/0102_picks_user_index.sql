-- Add a per-user index on picks to eliminate full table scans.
--
-- Problem: picks PRIMARY KEY is (day, match_id, user_id) and the only other
-- index is idx_picks_season_id. Any query filtering by user_id alone (or
-- user_id without a leading day range) does a full SCAN of the whole picks
-- table. EXPLAIN QUERY PLAN confirms `SELECT ... FROM picks WHERE user_id = ?`
-- => "SCAN picks". Dozens of per-user pick queries (achievement progress,
-- user stats, leaderboard breakdown) each read every row in picks, which
-- drives Cloudflare D1 "rows read" usage far higher than necessary.
--
-- Fix: a composite index on (user_id, day) lets these queries seek directly to
-- one user's rows instead of scanning the table. Covers both
-- `WHERE user_id = ?` and `WHERE user_id = ? AND day >= ?` patterns.
--
-- SAFETY: additive only. CREATE INDEX IF NOT EXISTS, no schema/data changes,
-- no behavior change. Fully reversible via DROP INDEX idx_picks_user.

CREATE INDEX IF NOT EXISTS idx_picks_user ON picks(user_id, day);
