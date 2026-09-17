-- Add unlock_time column to matches table
-- unlock_time is 24 hours before match starts
-- Predictions can only be made between unlock_time and lock_time

-- Restored 2026-08-05 (see 0005): production records this migration as applied, so the
-- ALTER only runs on a fresh database, where `matches` is empty.
ALTER TABLE matches ADD COLUMN unlock_time TEXT;

-- Update existing matches with unlock_time (24 hours before start_time)
UPDATE matches SET unlock_time = datetime(start_time, '-1 day');
