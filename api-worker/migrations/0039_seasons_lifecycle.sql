-- 0039_seasons_lifecycle.sql
-- Explicit season lifecycle + snapshot storage

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL CHECK (status IN ('upcoming', 'active', 'finalizing', 'finished', 'archived')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  activated_at TEXT,
  finalized_at TEXT,
  archived_at TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_slug ON seasons(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_active_only ON seasons(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_seasons_status_starts_at ON seasons(status, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_seasons_visible_order ON seasons(is_visible, display_order DESC, starts_at DESC);

INSERT OR IGNORE INTO seasons (
  id, name, slug, status, starts_at, ends_at,
  finalized_at, archived_at, display_order, is_visible, created_at, updated_at
)
VALUES (
  1,
  'Season 1',
  'season-1',
  'archived',
  '2000-01-01T00:00:00Z',
  '2026-02-02T22:30:00Z',
  '2026-02-02T22:30:00Z',
  '2026-02-02T22:30:00Z',
  1,
  1,
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO seasons (
  id, name, slug, status, starts_at, ends_at,
  activated_at, display_order, is_visible, created_at, updated_at
)
SELECT
  CAST(json_extract(value_json, '$.number') AS INTEGER) AS id,
  'Season ' || CAST(json_extract(value_json, '$.number') AS TEXT) AS name,
  'season-' || CAST(json_extract(value_json, '$.number') AS TEXT) AS slug,
  'active' AS status,
  json_extract(value_json, '$.start') AS starts_at,
  json_extract(value_json, '$.end') AS ends_at,
  datetime('now') AS activated_at,
  CAST(json_extract(value_json, '$.number') AS INTEGER) AS display_order,
  1 AS is_visible,
  datetime('now') AS created_at,
  datetime('now') AS updated_at
FROM app_settings
WHERE key = 'season'
  AND json_extract(value_json, '$.number') IS NOT NULL
  AND json_extract(value_json, '$.start') IS NOT NULL
  AND json_extract(value_json, '$.end') IS NOT NULL;

CREATE TABLE IF NOT EXISTS season_standings_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  final_rank INTEGER NOT NULL,
  final_points INTEGER NOT NULL DEFAULT 0,
  exact_hits INTEGER NOT NULL DEFAULT 0,
  diff_hits INTEGER NOT NULL DEFAULT 0,
  outcome_hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  joker_hits INTEGER NOT NULL DEFAULT 0,
  double_chance_saves INTEGER NOT NULL DEFAULT 0,
  matches_predicted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_season_standings_snapshot_unique
  ON season_standings_snapshot(season_id, user_id);
CREATE INDEX IF NOT EXISTS idx_season_standings_snapshot_rank
  ON season_standings_snapshot(season_id, final_rank);

CREATE TABLE IF NOT EXISTS season_league_standings_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  league_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  final_rank INTEGER NOT NULL,
  final_points INTEGER NOT NULL DEFAULT 0,
  exact_hits INTEGER NOT NULL DEFAULT 0,
  diff_hits INTEGER NOT NULL DEFAULT 0,
  outcome_hits INTEGER NOT NULL DEFAULT 0,
  joker_hits INTEGER NOT NULL DEFAULT 0,
  double_chance_saves INTEGER NOT NULL DEFAULT 0,
  matches_predicted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_season_league_snapshot_unique
  ON season_league_standings_snapshot(season_id, league_id, user_id);
CREATE INDEX IF NOT EXISTS idx_season_league_snapshot_rank
  ON season_league_standings_snapshot(season_id, league_id, final_rank);

CREATE TABLE IF NOT EXISTS season_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  league_id TEXT,
  award_type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_season_awards_season
  ON season_awards(season_id, award_type);

ALTER TABLE matches ADD COLUMN season_id INTEGER;
ALTER TABLE picks ADD COLUMN season_id INTEGER;
ALTER TABLE results ADD COLUMN season_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_matches_season_id ON matches(season_id, day, start_time);
CREATE INDEX IF NOT EXISTS idx_picks_season_id ON picks(season_id, user_id, day);
CREATE INDEX IF NOT EXISTS idx_results_season_id ON results(season_id, day);

UPDATE matches
SET season_id = (
  SELECT s.id
  FROM seasons s
  WHERE matches.start_time >= s.starts_at
    AND matches.start_time <= s.ends_at
  ORDER BY
    CASE s.status
      WHEN 'active' THEN 0
      WHEN 'finalizing' THEN 1
      WHEN 'finished' THEN 2
      WHEN 'upcoming' THEN 3
      ELSE 4
    END,
    s.starts_at DESC,
    s.id DESC
  LIMIT 1
)
WHERE season_id IS NULL;

UPDATE matches
SET season_id = 1
WHERE season_id IS NULL
  AND day < '2026-02-03';

UPDATE matches
SET season_id = (
  SELECT CAST(json_extract(value_json, '$.number') AS INTEGER)
  FROM app_settings
  WHERE key = 'season'
)
WHERE season_id IS NULL;

UPDATE picks
SET season_id = (
  SELECT m.season_id
  FROM matches m
  WHERE m.day = picks.day
    AND m.match_id = picks.match_id
  LIMIT 1
)
WHERE season_id IS NULL;

UPDATE results
SET season_id = (
  SELECT m.season_id
  FROM matches m
  WHERE m.day = results.day
    AND m.match_id = results.match_id
  LIMIT 1
)
WHERE season_id IS NULL;
