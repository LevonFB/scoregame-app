-- 0055_security_fixes.sql
-- Fix 1: Add UNIQUE constraint to prevent duplicate league membership (race condition)
CREATE UNIQUE INDEX IF NOT EXISTS idx_league_members_unique ON league_members(league_id, user_id);

-- Fix 2: Add opened_at column to daily_cases for atomic open tracking (race condition)
ALTER TABLE daily_cases ADD COLUMN opened_at INTEGER DEFAULT NULL;
