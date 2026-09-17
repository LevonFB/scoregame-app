-- 0073_season_prediction_tournament_players.sql
-- Player catalog for season-predictions individual award pickers.
-- Scoped to season_prediction_tournaments; no changes to regular match predictions,
-- economy, rewards, leagues, or WC2026 bracket.

CREATE TABLE IF NOT EXISTS season_prediction_tournament_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_tournament_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  player_id TEXT,
  provider TEXT,
  provider_player_id TEXT,
  player_name TEXT NOT NULL,
  player_name_normalized TEXT,
  position TEXT,
  position_group TEXT NOT NULL DEFAULT 'unknown'
    CHECK (position_group IN ('goalkeeper','defender','midfielder','forward','unknown')),
  shirt_number INTEGER,
  nationality TEXT,
  birth_date TEXT,
  photo_url TEXT,
  metadata_json TEXT DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_sptp_tournament ON season_prediction_tournament_players(season_prediction_tournament_id, is_active, player_name_normalized);
CREATE INDEX IF NOT EXISTS idx_sptp_code ON season_prediction_tournament_players(tournament_code, is_active);
CREATE INDEX IF NOT EXISTS idx_sptp_team ON season_prediction_tournament_players(season_prediction_tournament_id, team_id);
CREATE INDEX IF NOT EXISTS idx_sptp_position ON season_prediction_tournament_players(season_prediction_tournament_id, position_group, is_active);
CREATE INDEX IF NOT EXISTS idx_sptp_name ON season_prediction_tournament_players(player_name_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sptp_provider_player
  ON season_prediction_tournament_players(season_prediction_tournament_id, provider, provider_player_id)
  WHERE provider IS NOT NULL AND provider_player_id IS NOT NULL;
