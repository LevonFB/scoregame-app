-- 0075_season_prediction_reward_rules.sql
-- Stage R1: reward rules for season-prediction ratings (manual admin distribution).
-- Universal table for season predictions (NOT the WC2026 bracket_reward_rules).
-- Rewards are granted via the shared reward_ledger with source_type='manual_admin'
-- and a season-prediction unique_key, so this migration adds NO economy columns.
-- No auto-distribution, no rewards granted here — table starts empty; effective
-- defaults are applied by the API when an admin has not saved custom rules yet.

CREATE TABLE IF NOT EXISTS season_prediction_reward_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_season_id INTEGER NOT NULL,
  scope TEXT NOT NULL
    CHECK (scope IN ('season_overall','top5_overall','eurocups_overall')),
  rank_from INTEGER NOT NULL,
  rank_to INTEGER NOT NULL,
  reward_balls INTEGER NOT NULL DEFAULT 0,
  reward_stars INTEGER NOT NULL DEFAULT 0,
  reward_case_type TEXT,
  reward_case_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_manual_approval INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_sprr_season_scope
  ON season_prediction_reward_rules(season_prediction_season_id, scope, enabled);
