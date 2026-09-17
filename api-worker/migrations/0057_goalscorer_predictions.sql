-- Migration: Add tables for Goalscorer (Забьет) predictions

CREATE TABLE IF NOT EXISTS match_goalscorer_settings (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  scorers_json TEXT,
  resolved_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  PRIMARY KEY (day, match_id)
);

CREATE INDEX IF NOT EXISTS idx_match_goalscorer_settings_day ON match_goalscorer_settings(day, enabled);

CREATE TABLE IF NOT EXISTS pick_goalscorers (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pick_goalscorers_day_user ON pick_goalscorers(day, user_id);

CREATE TABLE IF NOT EXISTS match_squad_cache (
  match_id TEXT PRIMARY KEY,
  home_squad JSON,
  away_squad JSON,
  expires_at INTEGER NOT NULL
);
