-- 0068_season_predictions_26_27.sql
-- Isolated scaffold for "Прогнозы сезона" 2026/27.
-- No changes to existing match picks, leagues, tasks, economy, or WC2026 bracket tables.

CREATE TABLE IF NOT EXISTS season_prediction_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','locked','scoring','completed','archived')),
  app_season_id INTEGER,
  open_at INTEGER,
  deadline_at INTEGER,
  settings_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sps_code ON season_prediction_seasons(code);
CREATE INDEX IF NOT EXISTS idx_sps_status ON season_prediction_seasons(status);

CREATE TABLE IF NOT EXISTS season_prediction_tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_season_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  tournament_type TEXT NOT NULL DEFAULT 'top_league',
  title TEXT NOT NULL,
  country TEXT,
  team_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','locked','scoring','completed','archived')),
  open_at INTEGER,
  deadline_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100,
  settings_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(season_prediction_season_id, tournament_code)
);

CREATE INDEX IF NOT EXISTS idx_spt_season ON season_prediction_tournaments(season_prediction_season_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_spt_code ON season_prediction_tournaments(tournament_code);
CREATE INDEX IF NOT EXISTS idx_spt_status ON season_prediction_tournaments(status);

CREATE TABLE IF NOT EXISTS season_prediction_tournament_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER NOT NULL,
  team_id TEXT,
  team_name TEXT NOT NULL,
  short_name TEXT,
  crest_url TEXT,
  provider TEXT,
  provider_team_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  metadata_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(season_prediction_tournament_id, team_id),
  UNIQUE(season_prediction_tournament_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_sptt_tournament ON season_prediction_tournament_teams(season_prediction_tournament_id, sort_order);

CREATE TABLE IF NOT EXISTS season_prediction_tournament_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER NOT NULL UNIQUE,
  zones_json TEXT NOT NULL DEFAULT '{}',
  playoff_rules_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS season_prediction_user_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  season_prediction_season_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','locked','scoring','completed')),
  table_json TEXT,
  awards_json TEXT,
  submitted_at INTEGER,
  last_submitted_at INTEGER,
  locked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, season_prediction_season_id, tournament_code)
);

CREATE INDEX IF NOT EXISTS idx_spue_user ON season_prediction_user_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_spue_season ON season_prediction_user_entries(season_prediction_season_id);
CREATE INDEX IF NOT EXISTS idx_spue_tournament ON season_prediction_user_entries(tournament_code);
CREATE INDEX IF NOT EXISTS idx_spue_status ON season_prediction_user_entries(status);
CREATE INDEX IF NOT EXISTS idx_spue_user_season ON season_prediction_user_entries(user_id, season_prediction_season_id);

CREATE TABLE IF NOT EXISTS season_prediction_award_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER NOT NULL,
  award_type TEXT NOT NULL CHECK (award_type IN ('top_scorer','top_assister','golden_glove')),
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  metadata_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_spao_tournament_type ON season_prediction_award_options(season_prediction_tournament_id, award_type, sort_order);

INSERT OR IGNORE INTO season_prediction_seasons (
  code, title, status, settings_json
) VALUES (
  'club_2026_27',
  'Прогнозы сезона 2026/27',
  'draft',
  '{"mode":"season_predictions","version":"stage_1","scoring_enabled":false,"rewards_enabled":false}'
);

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'PL', 'top_league', 'АПЛ', 'England', 20, 'draft', 10, '{"competition_code":"PL"}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'PD', 'top_league', 'Ла Лига', 'Spain', 20, 'draft', 20, '{"competition_code":"PD"}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'SA', 'top_league', 'Серия А', 'Italy', 20, 'draft', 30, '{"competition_code":"SA"}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'BL1', 'top_league', 'Бундеслига', 'Germany', 18, 'draft', 40, '{"competition_code":"BL1"}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'FL1', 'top_league', 'Лига 1', 'France', 18, 'draft', 50, '{"competition_code":"FL1"}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournament_rules (
  season_prediction_tournament_id, zones_json, playoff_rules_json
)
SELECT id, '{"champion":[1,1],"champions_league":[1,4],"europa_league":[5,5],"conference_league":[6,6],"relegation":[18,20],"playoff":[]}', '{}'
FROM season_prediction_tournaments WHERE tournament_code IN ('PL','PD','SA');

INSERT OR IGNORE INTO season_prediction_tournament_rules (
  season_prediction_tournament_id, zones_json, playoff_rules_json
)
SELECT id, '{"champion":[1,1],"champions_league":[1,4],"europa_league":[5,5],"conference_league":[6,6],"relegation":[17,18],"playoff":[16,16]}', '{}'
FROM season_prediction_tournaments WHERE tournament_code IN ('BL1','FL1');
