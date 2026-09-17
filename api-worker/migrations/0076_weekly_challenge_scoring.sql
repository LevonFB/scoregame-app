-- 0076_weekly_challenge_scoring.sql
-- Stage W1: official answers + scoring for "Вызов недели".
-- Adds official-answer columns to questions and a dedicated scores table.
-- No rewards, no economy, no leaderboard, no auto-distribution.

-- Official answer per question (separate from question.status active/disabled/void).
ALTER TABLE season_prediction_weekly_challenge_questions ADD COLUMN official_answer_option_id TEXT;
ALTER TABLE season_prediction_weekly_challenge_questions ADD COLUMN official_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE season_prediction_weekly_challenge_questions ADD COLUMN official_note TEXT;
ALTER TABLE season_prediction_weekly_challenge_questions ADD COLUMN official_confirmed_at INTEGER;
ALTER TABLE season_prediction_weekly_challenge_questions ADD COLUMN official_confirmed_by_admin_id INTEGER;

-- Per-entry score (mirrors season_prediction_user_scores style). One per user+challenge.
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
