-- 0040_match_mode_national_teams.sql
-- Global club / national teams mode + normalized match typing

ALTER TABLE matches ADD COLUMN competition_type TEXT;
ALTER TABLE matches ADD COLUMN match_type TEXT;

CREATE INDEX IF NOT EXISTS idx_matches_day_match_type
  ON matches(day, match_type, is_pick, start_time);

INSERT OR IGNORE INTO app_settings (key, value_json, updated_at, updated_by)
VALUES ('match_mode', '{"mode":"club"}', datetime('now'), 0);

UPDATE matches
SET
  competition_type = 'national_team',
  match_type = 'national_team'
WHERE competition IN ('WC', 'EC', 'NL', 'WCQ', 'ECQ', 'FI')
  AND (
    competition_type IS NULL
    OR match_type IS NULL
  );

UPDATE matches
SET
  competition_type = COALESCE(competition_type, 'club'),
  match_type = COALESCE(match_type, 'club')
WHERE competition_type IS NULL
   OR match_type IS NULL;
