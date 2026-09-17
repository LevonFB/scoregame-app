-- 0008_refactor_matches.sql
-- Add flags to identify Top-3 picks among all matches

ALTER TABLE matches ADD COLUMN is_pick INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN pick_mode TEXT; -- 'AUTO' | 'MANUAL'
CREATE INDEX IF NOT EXISTS idx_matches_day_pick ON matches(day, is_pick);
