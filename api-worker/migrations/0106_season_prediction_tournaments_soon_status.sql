-- 0106_season_prediction_tournaments_soon_status.sql
-- Allow the new 'soon' tournament status. The status column carries a CHECK
-- constraint (from 0068) that SQLite/D1 cannot ALTER in place, so we rebuild the
-- table with the extended allow-list and copy every row.
--
-- Safety notes:
--  - No other table declares a FOREIGN KEY REFERENCES to this table (verified), so
--    dropping/renaming it does not break referential integrity. Child tables link by
--    plain season_prediction_tournament_id columns (no FK enforcement).
--  - Column set below = base schema (0068) + awards_open_at/awards_deadline_at (0105).
--    Live schema is in sync with migrations, so no columns are lost.
--  - id values are copied verbatim to preserve child-row references.
--
-- Data impact: none beyond widening the allowed status set; all rows preserved.

CREATE TABLE season_prediction_tournaments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_prediction_season_id INTEGER NOT NULL,
  tournament_code TEXT NOT NULL,
  tournament_type TEXT NOT NULL DEFAULT 'top_league',
  title TEXT NOT NULL,
  country TEXT,
  team_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','soon','open','locked','scoring','completed','archived')),
  open_at INTEGER,
  deadline_at INTEGER,
  awards_open_at INTEGER,
  awards_deadline_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100,
  settings_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(season_prediction_season_id, tournament_code)
);

INSERT INTO season_prediction_tournaments_new (
  id, season_prediction_season_id, tournament_code, tournament_type, title, country,
  team_count, status, open_at, deadline_at, awards_open_at, awards_deadline_at,
  sort_order, settings_json, created_at, updated_at
)
SELECT
  id, season_prediction_season_id, tournament_code, tournament_type, title, country,
  team_count, status, open_at, deadline_at, awards_open_at, awards_deadline_at,
  sort_order, settings_json, created_at, updated_at
FROM season_prediction_tournaments;

DROP TABLE season_prediction_tournaments;
ALTER TABLE season_prediction_tournaments_new RENAME TO season_prediction_tournaments;

CREATE INDEX IF NOT EXISTS idx_spt_season ON season_prediction_tournaments(season_prediction_season_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_spt_code ON season_prediction_tournaments(tournament_code);
CREATE INDEX IF NOT EXISTS idx_spt_status ON season_prediction_tournaments(status);
