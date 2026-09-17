-- 0070_season_predictions_weekly_challenge.sql
-- "Вызов недели" inside "Прогнозы сезона": 5-question weekly mini-mode.
-- Scoping: isolated from regular match picks, leagues, economy, WC2026.
-- No scoring, ratings, quests, rewards. Only scaffold + admin + draft/submit.

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_season_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','locked','scoring','completed','archived')),
  open_at INTEGER,
  deadline_at INTEGER,
  close_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100,
  settings_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(season_prediction_season_id, code)
);

CREATE INDEX IF NOT EXISTS idx_spwc_season ON season_prediction_weekly_challenges(season_prediction_season_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_spwc_status ON season_prediction_weekly_challenges(status);
CREATE INDEX IF NOT EXISTS idx_spwc_deadline ON season_prediction_weekly_challenges(deadline_at);

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenge_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_challenge_id INTEGER NOT NULL,
  match_id TEXT,
  provider TEXT,
  provider_match_id TEXT,
  tournament_code TEXT,
  home_team_name TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  kickoff_at INTEGER,
  status TEXT,
  score_home INTEGER,
  score_away INTEGER,
  metadata_json TEXT DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_spwcm_challenge ON season_prediction_weekly_challenge_matches(weekly_challenge_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_spwcm_match ON season_prediction_weekly_challenge_matches(match_id);

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenge_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_challenge_id INTEGER NOT NULL,
  question_key TEXT NOT NULL CHECK (question_key IN ('match_of_week','league_of_week','duel_of_week','upset_of_week','event_of_week')),
  title TEXT NOT NULL,
  description TEXT,
  question_type TEXT NOT NULL DEFAULT 'single_select',
  options_json TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','void')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(weekly_challenge_id, question_key)
);

CREATE INDEX IF NOT EXISTS idx_spwcq_challenge ON season_prediction_weekly_challenge_questions(weekly_challenge_id, sort_order);

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  weekly_challenge_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','locked','scoring','completed')),
  answers_json TEXT DEFAULT '{}',
  submitted_at INTEGER,
  last_submitted_at INTEGER,
  locked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, weekly_challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_spwce_user ON season_prediction_weekly_challenge_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_spwce_challenge ON season_prediction_weekly_challenge_entries(weekly_challenge_id);
CREATE INDEX IF NOT EXISTS idx_spwce_status ON season_prediction_weekly_challenge_entries(status);
CREATE INDEX IF NOT EXISTS idx_spwce_user_challenge ON season_prediction_weekly_challenge_entries(user_id, weekly_challenge_id);
