-- Weekly Challenge Tasks V2 E2E fixture.
-- Local Miniflare D1 only. Never applied to production.

CREATE TABLE IF NOT EXISTS season_prediction_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  app_season_id INTEGER,
  open_at INTEGER,
  deadline_at INTEGER,
  settings_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at INTEGER,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_season_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  open_at INTEGER,
  deadline_at INTEGER,
  close_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100,
  settings_json TEXT DEFAULT '{}',
  task_schema_version INTEGER NOT NULL DEFAULT 1,
  bonus_question_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(season_prediction_season_id, code)
);
CREATE INDEX IF NOT EXISTS idx_spwc_season ON season_prediction_weekly_challenges(season_prediction_season_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_spwc_status ON season_prediction_weekly_challenges(status);
CREATE INDEX IF NOT EXISTS idx_spwc_deadline ON season_prediction_weekly_challenges(deadline_at);
CREATE INDEX IF NOT EXISTS idx_sp_weekly_challenges_task_schema ON season_prediction_weekly_challenges(task_schema_version);

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
  question_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  question_type TEXT NOT NULL DEFAULT 'single_select',
  options_json TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 100,
  official_answer_option_id TEXT,
  official_status TEXT NOT NULL DEFAULT 'pending',
  official_note TEXT,
  official_confirmed_at INTEGER,
  official_confirmed_by_admin_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(weekly_challenge_id, question_key)
);
CREATE INDEX IF NOT EXISTS idx_spwcq_challenge ON season_prediction_weekly_challenge_questions(weekly_challenge_id, sort_order);

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  weekly_challenge_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
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

CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenge_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_challenge_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  entry_id INTEGER NOT NULL,
  formula_version TEXT NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  max_possible_points INTEGER NOT NULL DEFAULT 0,
  points_pct REAL NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  wrong_answers INTEGER NOT NULL DEFAULT 0,
  void_questions INTEGER NOT NULL DEFAULT 0,
  unanswered_questions INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  scored_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  scored_by_recalc_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(weekly_challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_spwcs_challenge ON season_prediction_weekly_challenge_scores(weekly_challenge_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_spwcs_user ON season_prediction_weekly_challenge_scores(user_id);

CREATE TABLE IF NOT EXISTS season_prediction_recalc_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER,
  triggered_by_admin_id INTEGER NOT NULL,
  trigger_reason TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  formula_version TEXT NOT NULL,
  formula_config_json TEXT NOT NULL DEFAULT '{}',
  entries_processed INTEGER NOT NULL DEFAULT 0,
  entries_skipped INTEGER NOT NULL DEFAULT 0,
  entries_failed INTEGER NOT NULL DEFAULT 0,
  avg_points REAL,
  max_points INTEGER,
  pre_snapshot_json TEXT,
  started_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  finished_at INTEGER,
  error_message TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_sprl_status ON season_prediction_recalc_log(status);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  case_type TEXT,
  status TEXT NOT NULL DEFAULT 'granted',
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  granted_by INTEGER,
  revoked_at INTEGER,
  revoked_by INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS weekly_challenge_task_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_challenge_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  lock_token TEXT,
  reward_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  completed_at INTEGER,
  UNIQUE(weekly_challenge_id, user_id, task_key)
);
CREATE INDEX IF NOT EXISTS idx_wctc_user_status ON weekly_challenge_task_claims(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_wctc_challenge_user ON weekly_challenge_task_claims(weekly_challenge_id, user_id);

INSERT OR IGNORE INTO season_prediction_seasons
  (id, code, title, status, open_at, deadline_at, settings_json, created_at, updated_at)
VALUES
  (100, 'club_2026_27', 'Season Predictions E2E', 'open', 1, 4102444800, '{}', 1, 1);

INSERT OR IGNORE INTO users (id, username, first_name, balls, extra_league_slots)
VALUES
  (777777, 'weekly_user', 'Weekly User', 0, 0),
  (111111, 'weekly_admin', 'Weekly Admin', 0, 0);
