-- 0078_eurocup_knockout_foundation.sql
-- Stage E6: playoff (knockout) foundation for eurocups (UCL/UEL/UECL).
-- DATA + DRAFT STORAGE ONLY — no scoring, no recalc, no leaderboard, no rewards.
-- Playoff points arrive in a later stage (E7 / eurocups_v2). These tables are
-- additive and do NOT touch the league-stage tables, official results, scores,
-- leaderboards, or rewards.

-- Official knockout bracket slots (admin-managed pairings + winners).
CREATE TABLE IF NOT EXISTS season_prediction_eurocup_knockout_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  tournament_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('knockout_playoffs','round_of_16','quarter_final','semi_final','final')),
  match_order INTEGER NOT NULL DEFAULT 0,
  match_key TEXT NOT NULL,
  team_a_id TEXT,
  team_b_id TEXT,
  team_a_source TEXT,
  team_b_source TEXT,
  winner_team_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','completed','void')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','provider')),
  confirmed_at INTEGER,
  confirmed_by_admin_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(season_id, tournament_code, match_key)
);
CREATE INDEX IF NOT EXISTS idx_eurocup_ko_matches_tournament
  ON season_prediction_eurocup_knockout_matches(tournament_id, stage, match_order);

-- User playoff predictions (separate from the league-stage entry to avoid drift).
CREATE TABLE IF NOT EXISTS season_prediction_eurocup_knockout_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  tournament_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','locked','completed')),
  picks_json TEXT NOT NULL DEFAULT '{}',
  submitted_at INTEGER,
  last_submitted_at INTEGER,
  locked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(season_id, tournament_code, user_id)
);
CREATE INDEX IF NOT EXISTS idx_eurocup_ko_brackets_user
  ON season_prediction_eurocup_knockout_brackets(user_id, tournament_code);
