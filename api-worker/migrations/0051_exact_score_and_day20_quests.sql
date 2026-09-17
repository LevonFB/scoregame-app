-- 0051_exact_score_and_day20_quests.sql
-- Adds:
--   - new daily quest "Точный выстрел"
--   - new seasonal quest "Разгон до 20"

----------------------------------------------------------------------
-- 1) Seasonal achievement definition
----------------------------------------------------------------------
INSERT OR IGNORE INTO achievements (
  id, scope, rarity, emoji, title, description, condition_type, threshold, stars_reward
) VALUES (
  'global_day20',
  'global',
  'epic',
  '🚀',
  'Разгон до 20',
  'Наберите 20 очков за игровой день',
  'day_points',
  20,
  0
);

UPDATE achievements
SET
  scope = 'global',
  rarity = 'epic',
  emoji = '🚀',
  title = 'Разгон до 20',
  description = 'Наберите 20 очков за игровой день',
  condition_type = 'day_points',
  threshold = 20,
  stars_reward = 0
WHERE id = 'global_day20';

----------------------------------------------------------------------
-- 2) Tasks catalog entries for admin/editing
----------------------------------------------------------------------
INSERT OR IGNORE INTO tasks_catalog (
  task_key, task_type, scope, emoji, title, description,
  reward_stars, progress_target, progress_kind, reset_scope,
  phase, league_only, rarity, sort_order, period_type, claim_mode, ranking_based
) VALUES
  (
    'dq_exact_score',
    'daily',
    'global',
    '🎯',
    'Точный выстрел',
    'Угадайте точный счёт в одном из матчей дня',
    2,
    NULL,
    'boolean',
    'matchday',
    'scores_updated',
    0,
    'common',
    6,
    'daily',
    'auto',
    0
  ),
  (
    'global_day20',
    'seasonal',
    'global',
    '🚀',
    'Разгон до 20',
    'Наберите 20 очков за игровой день',
    0,
    20,
    'best',
    'season',
    'scores_updated',
    0,
    'epic',
    38,
    'seasonal',
    'auto',
    0
  );

UPDATE tasks_catalog
SET
  task_type = 'daily',
  scope = 'global',
  emoji = '🎯',
  title = 'Точный выстрел',
  description = 'Угадайте точный счёт в одном из матчей дня',
  reward_stars = 2,
  progress_target = NULL,
  progress_kind = 'boolean',
  reset_scope = 'matchday',
  phase = 'scores_updated',
  league_only = 0,
  rarity = 'common',
  sort_order = 6,
  period_type = 'daily',
  claim_mode = 'auto',
  ranking_based = 0
WHERE task_key = 'dq_exact_score';

UPDATE tasks_catalog
SET
  task_type = 'seasonal',
  scope = 'global',
  emoji = '🚀',
  title = 'Разгон до 20',
  description = 'Наберите 20 очков за игровой день',
  reward_stars = 0,
  progress_target = 20,
  progress_kind = 'best',
  reset_scope = 'season',
  phase = 'scores_updated',
  league_only = 0,
  rarity = 'epic',
  sort_order = 38,
  period_type = 'seasonal',
  claim_mode = 'auto',
  ranking_based = 0
WHERE task_key = 'global_day20';
