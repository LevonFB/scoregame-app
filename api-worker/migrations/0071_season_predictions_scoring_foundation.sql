-- 0071_season_predictions_scoring_foundation.sql
-- Stage S1 of "Топ-5 лиг" scoring: data foundation + admin official results.
-- NO scoring engine runs here, NO recalculation, NO leaderboard, NO rewards.
-- Tables are created empty; user_scores/recalc_log stay unfilled on S1.

-- 1. Admin-confirmed official final table per tournament (source of truth, NOT provider).
CREATE TABLE IF NOT EXISTS season_prediction_official_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','published','superseded')),
  table_json TEXT NOT NULL DEFAULT '{}',
  zones_snapshot_json TEXT NOT NULL DEFAULT '{}',
  team_ids_snapshot_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'admin_manual'
    CHECK (source IN ('admin_manual','football_data_import','allsports_import')),
  provider_payload_json TEXT,
  confirmed_at INTEGER,
  confirmed_by_admin_id INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_spor_tournament ON season_prediction_official_results(season_prediction_tournament_id);
CREATE INDEX IF NOT EXISTS idx_spor_status ON season_prediction_official_results(status);

-- 2. Admin-confirmed official individual award winners.
CREATE TABLE IF NOT EXISTS season_prediction_official_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER NOT NULL,
  award_type TEXT NOT NULL
    CHECK (award_type IN ('top_scorer','top_assistant','golden_glove')),
  award_option_id INTEGER,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','published','superseded')),
  source TEXT NOT NULL DEFAULT 'admin_manual'
    CHECK (source IN ('admin_manual','football_data_import','allsports_import')),
  confirmed_at INTEGER,
  confirmed_by_admin_id INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(season_prediction_tournament_id, award_type)
);

CREATE INDEX IF NOT EXISTS idx_spoa_tournament ON season_prediction_official_awards(season_prediction_tournament_id, award_type);

-- 3. Per-entry score breakdown (filled later by the scoring engine — empty on S1).
CREATE TABLE IF NOT EXISTS season_prediction_user_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  season_prediction_season_id INTEGER NOT NULL,
  season_prediction_tournament_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  user_entry_id INTEGER NOT NULL,
  table_points INTEGER NOT NULL DEFAULT 0,
  zone_points INTEGER NOT NULL DEFAULT 0,
  bonus_points INTEGER NOT NULL DEFAULT 0,
  champion_points INTEGER NOT NULL DEFAULT 0,
  awards_points INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  max_possible_points INTEGER NOT NULL DEFAULT 0,
  points_pct REAL NOT NULL DEFAULT 0,
  exact_positions INTEGER NOT NULL DEFAULT 0,
  errors_le_1 INTEGER NOT NULL DEFAULT 0,
  errors_le_2 INTEGER NOT NULL DEFAULT 0,
  champion_correct INTEGER NOT NULL DEFAULT 0,
  ucl_zone_correct INTEGER NOT NULL DEFAULT 0,
  ucl_zone_full INTEGER NOT NULL DEFAULT 0,
  relegation_zone_correct INTEGER NOT NULL DEFAULT 0,
  relegation_zone_full INTEGER NOT NULL DEFAULT 0,
  awards_correct INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  scored_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  scored_by_recalc_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(user_id, season_prediction_tournament_id)
);

CREATE INDEX IF NOT EXISTS idx_spus_tournament_points ON season_prediction_user_scores(season_prediction_tournament_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_spus_user ON season_prediction_user_scores(user_id, season_prediction_season_id);

-- 4. Audit log for recalculation runs (no runs happen on S1).
CREATE TABLE IF NOT EXISTS season_prediction_recalc_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER,
  triggered_by_admin_id INTEGER NOT NULL,
  trigger_reason TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','rolled_back')),
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

CREATE INDEX IF NOT EXISTS idx_sprl_tournament ON season_prediction_recalc_log(season_prediction_tournament_id);
CREATE INDEX IF NOT EXISTS idx_sprl_status ON season_prediction_recalc_log(status);
