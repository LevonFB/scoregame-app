CREATE TABLE IF NOT EXISTS matches (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  competition TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  start_time TEXT NOT NULL,
  lock_time TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, match_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_day ON matches(day);
