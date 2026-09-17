-- 0012_achievements_seen_at.sql
-- Add seen_at field for toast acknowledgment

ALTER TABLE user_achievements ADD COLUMN seen_at INTEGER DEFAULT NULL;
