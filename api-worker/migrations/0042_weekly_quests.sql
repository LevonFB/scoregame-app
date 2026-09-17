-- 0042_weekly_quests.sql
-- Weekly quests, weekly finalization, and weekly league standings snapshots.

ALTER TABLE tasks_catalog ADD COLUMN period_type TEXT NOT NULL DEFAULT 'seasonal';
ALTER TABLE tasks_catalog ADD COLUMN claim_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE tasks_catalog ADD COLUMN ranking_based INTEGER NOT NULL DEFAULT 0;

UPDATE tasks_catalog
SET period_type = CASE
  WHEN task_type = 'daily' THEN 'daily'
  ELSE 'seasonal'
END
WHERE period_type IS NULL OR TRIM(period_type) = '';

CREATE INDEX IF NOT EXISTS idx_tasks_catalog_period_type
  ON tasks_catalog(period_type, scope, sort_order);

CREATE TABLE IF NOT EXISTS weekly_finalizations (
  season_id     INTEGER NOT NULL,
  week_key      TEXT NOT NULL,
  week_start    TEXT NOT NULL,
  week_end      TEXT NOT NULL,
  cutoff_at     INTEGER NOT NULL,
  finalized_at  INTEGER NOT NULL,
  reason        TEXT,
  PRIMARY KEY (season_id, week_key)
);

CREATE TABLE IF NOT EXISTS weekly_league_standings_snapshot (
  season_id          INTEGER NOT NULL,
  week_key           TEXT NOT NULL,
  league_id          TEXT NOT NULL,
  user_id            INTEGER NOT NULL,
  final_rank         INTEGER NOT NULL,
  final_points       INTEGER NOT NULL,
  exact_hits         INTEGER NOT NULL DEFAULT 0,
  joker_points       INTEGER NOT NULL DEFAULT 0,
  matches_predicted  INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (season_id, week_key, league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_finalizations_week
  ON weekly_finalizations(week_key, finalized_at);

CREATE INDEX IF NOT EXISTS idx_weekly_league_snapshot_lookup
  ON weekly_league_standings_snapshot(season_id, week_key, league_id, final_rank);

INSERT OR IGNORE INTO tasks_catalog (
  task_key, task_type, scope, emoji, title, description,
  reward_stars, progress_target, progress_kind, reset_scope,
  phase, league_only, rarity, sort_order, period_type, claim_mode, ranking_based
) VALUES
  (
    'weekly_active_days_3',
    'seasonal',
    'global',
    '📅',
    'На дистанции',
    'Сделайте прогнозы в 3 active days текущей недели',
    8,
    3,
    'counter',
    'season',
    'pick_saved',
    0,
    'rare',
    100,
    'weekly',
    'auto',
    0
  ),
  (
    'weekly_points_days_3',
    'seasonal',
    'global',
    '⚽',
    'Ровная игра',
    'Наберите хотя бы 1 очко в 3 active days текущей недели',
    8,
    3,
    'counter',
    'season',
    'scores_updated',
    0,
    'rare',
    101,
    'weekly',
    'auto',
    0
  );

UPDATE tasks_catalog
SET
  title = 'Точный дубль',
  description = 'Угадайте 2 точных счёта за неделю',
  reward_stars = 12,
  progress_target = 2,
  progress_kind = 'counter',
  phase = 'scores_updated',
  rarity = 'rare',
  sort_order = 102,
  period_type = 'weekly',
  claim_mode = 'auto',
  ranking_based = 0
WHERE task_key = 'global_double_exact_week';

UPDATE tasks_catalog
SET
  title = 'В тройке недели',
  description = 'Займите топ-3 в лиге по итогам недели',
  reward_stars = 14,
  progress_target = 3,
  progress_kind = 'best',
  phase = 'scores_updated',
  rarity = 'rare',
  sort_order = 110,
  period_type = 'weekly',
  claim_mode = 'auto',
  ranking_based = 1
WHERE task_key = 'league_top3_week';

UPDATE tasks_catalog
SET
  title = 'Чемпион недели',
  description = 'Займите 1 место в лиге по итогам недели',
  reward_stars = 20,
  progress_target = 1,
  progress_kind = 'best',
  phase = 'scores_updated',
  rarity = 'epic',
  sort_order = 111,
  period_type = 'weekly',
  claim_mode = 'auto',
  ranking_based = 1
WHERE task_key = 'league_champion_week';
