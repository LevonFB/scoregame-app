-- Migration 0024: Add matchday_key column for "football day" (07:00 MSK boundary)
-- matchday_key = date(start_time_utc - 4h), where 4h = MSK offset(+3) minus boundary(7h) cutoff
ALTER TABLE matches ADD COLUMN matchday_key TEXT;
CREATE INDEX IF NOT EXISTS idx_matches_matchday_pick ON matches (matchday_key, is_pick);
