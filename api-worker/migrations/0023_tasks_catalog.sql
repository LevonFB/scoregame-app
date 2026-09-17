-- 0023_tasks_catalog.sql
-- Unified Tasks Catalog Architecture:
--   tasks_catalog   = single source of truth for all tasks (daily + seasonal)
--   user_task_progress = per-user per-season progress
--   stars_ledger     = idempotent star award log
-- Also: is_pick_approved column on matches for approved matchday logic.

----------------------------------------------------------------------
-- 0) Add is_pick_approved to matches (matchday approval)
----------------------------------------------------------------------
ALTER TABLE matches ADD COLUMN is_pick_approved INTEGER NOT NULL DEFAULT 0;
-- Backfill: all existing is_pick=1 are already approved
UPDATE matches SET is_pick_approved = 1 WHERE is_pick = 1;

----------------------------------------------------------------------
-- 1) tasks_catalog — unified catalog of ALL tasks
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks_catalog (
  task_key        TEXT PRIMARY KEY,
  task_type       TEXT NOT NULL CHECK (task_type IN ('daily','seasonal')),
  scope           TEXT NOT NULL CHECK (scope IN ('global','league')),
  emoji           TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  reward_stars    INTEGER NOT NULL DEFAULT 0,
  reward_balls    INTEGER NOT NULL DEFAULT 0,
  progress_target INTEGER,
  progress_kind   TEXT NOT NULL DEFAULT 'boolean'
                  CHECK (progress_kind IN ('boolean','counter','streak','best')),
  reset_scope     TEXT NOT NULL DEFAULT 'season'
                  CHECK (reset_scope IN ('season','matchday')),
  phase           TEXT NOT NULL DEFAULT 'pick_saved'
                  CHECK (phase IN ('pick_saved','scores_updated')),
  league_only     INTEGER NOT NULL DEFAULT 0,
  rarity          TEXT NOT NULL DEFAULT 'common'
                  CHECK (rarity IN ('common','rare','epic')),
  sort_order      INTEGER NOT NULL DEFAULT 100
);

----------------------------------------------------------------------
-- 2) user_task_progress — per-season user progress
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_task_progress (
  user_id         INTEGER NOT NULL,
  season_id       INTEGER NOT NULL,
  task_key        TEXT    NOT NULL,
  instance_key    TEXT    NOT NULL, -- 'season' or 'matchday:YYYY-MM-DD'
  progress        INTEGER NOT NULL DEFAULT 0,
  completed_at    INTEGER,
  reward_granted  INTEGER NOT NULL DEFAULT 0,
  shown_at        INTEGER,
  PRIMARY KEY (user_id, season_id, task_key, instance_key)
);
CREATE INDEX IF NOT EXISTS idx_utp_user_season ON user_task_progress(user_id, season_id);
CREATE INDEX IF NOT EXISTS idx_utp_shown ON user_task_progress(user_id, season_id, shown_at);

----------------------------------------------------------------------
-- 3) stars_ledger — idempotent star award log
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stars_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  season_id       INTEGER NOT NULL,
  source          TEXT    NOT NULL, -- 'daily_task','seasonal_task','case','admin'
  task_key        TEXT    NOT NULL,
  instance_key    TEXT    NOT NULL,
  stars           INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sl_unique
  ON stars_ledger(user_id, season_id, task_key, instance_key);
CREATE INDEX IF NOT EXISTS idx_sl_user_season ON stars_ledger(user_id, season_id);

----------------------------------------------------------------------
-- 4) Seed tasks_catalog — DAILY tasks
----------------------------------------------------------------------
INSERT OR IGNORE INTO tasks_catalog (task_key, task_type, scope, emoji, title, description, reward_stars, progress_target, progress_kind, reset_scope, phase, league_only, rarity, sort_order) VALUES
  ('dq_full_day',      'daily', 'global', '⏱️',   'Полные девяносто',     'Сделайте прогнозы на все матчи дня до начала игр',     3, NULL, 'boolean', 'matchday', 'pick_saved',     0, 'common', 1),
  ('dq_early_start',   'daily', 'global', '⏰',   'Ранний старт',         'Сделайте прогноз минимум за 3 часа до начала матча',   1, NULL, 'boolean', 'matchday', 'pick_saved',     0, 'common', 2),
  ('dq_captain',       'daily', 'global', '🃏',   'Капитанский выбор',    'Используйте джокер на одном из матчей',                1, NULL, 'boolean', 'matchday', 'pick_saved',     0, 'common', 3),
  ('dq_read_game',     'daily', 'global', '👀',   'Чтение игры',          'Угадайте исход матча',                                1, NULL, 'boolean', 'matchday', 'scores_updated', 0, 'common', 4),
  ('dq_feel_score',    'daily', 'global', '📊',   'Чувство счёта',        'Угадайте разницу мячей',                              1, NULL, 'boolean', 'matchday', 'scores_updated', 0, 'common', 5),
  ('dq_joker_played',  'daily', 'global', '🃏✅', 'Джокер сыграл',        'Наберите очки на матче с джокером',                    1, NULL, 'boolean', 'matchday', 'scores_updated', 0, 'common', 6),
  ('dq_league_points', 'daily', 'league', '🏆',   'День с очками',        'Наберите хотя бы 1 очко за день в лиге',              2, NULL, 'boolean', 'matchday', 'scores_updated', 1, 'common', 7),
  ('dq_league_win',    'daily', 'league', '👑',   'Победа дня',           'Займите 1 место в лиге по итогам дня',                3, NULL, 'boolean', 'matchday', 'scores_updated', 1, 'common', 8);

----------------------------------------------------------------------
-- 5) Seed tasks_catalog — SEASONAL GLOBAL tasks
----------------------------------------------------------------------
INSERT OR IGNORE INTO tasks_catalog (task_key, task_type, scope, emoji, title, description, reward_stars, progress_target, progress_kind, reset_scope, phase, league_only, rarity, sort_order) VALUES
  -- Common
  ('global_debut',              'seasonal', 'global', '🏟️',   'Выход на поле',          'Сделайте свой первый прогноз за сезон',                4, 1,  'counter',  'season', 'pick_saved',     0, 'common', 10),
  -- Rare
  ('global_scoreboard',         'seasonal', 'global', '🎯',   'На табло',               'Угадайте точный счёт матча',                          16, 1,  'counter',  'season', 'scores_updated', 0, 'rare',   20),
  ('global_streak_3',           'seasonal', 'global', '🔁',   'На серии',               'Делайте прогнозы 3 дня подряд',                       12, 3,  'streak',   'season', 'pick_saved',     0, 'rare',   21),
  ('global_3of3_points',        'seasonal', 'global', '✅',   'Три из трёх',            'Наберите очки во всех 3 матчах дня',                  10, 1,  'boolean',  'season', 'scores_updated', 0, 'rare',   22),
  ('global_big_day',            'seasonal', 'global', '🔥',   'Большой день',           'Наберите 10 или более очков за день',                  12, 10, 'best',     'season', 'scores_updated', 0, 'rare',   23),
  ('global_joker_doublehit',    'seasonal', 'global', '🃏⚡', 'Удар на удвоение',       'Получите 6+ очков на джокере (x2)',                    10, 6,  'best',     'season', 'scores_updated', 0, 'rare',   24),
  ('global_joker_streak_3',     'seasonal', 'global', '🃏🔁', 'Джокер-стрик',           'Джокер приносит очки 3 дня подряд',                   16, 3,  'streak',   'season', 'scores_updated', 0, 'rare',   25),
  ('global_new_peak',           'seasonal', 'global', '📈',   'Новая планка',           'Обновите свой рекорд очков за день',                  12, 1,  'boolean',  'season', 'scores_updated', 0, 'rare',   26),
  ('global_steady',             'seasonal', 'global', '🧱',   'Ровный темп',            'Набирайте очки 5 дней подряд',                        16, 5,  'streak',   'season', 'scores_updated', 0, 'rare',   27),
  -- Epic
  ('global_streak_7',           'seasonal', 'global', '💪',   'Неделя в форме',         'Делайте прогнозы 7 дней подряд',                      20, 7,  'streak',   'season', 'pick_saved',     0, 'epic',   30),
  ('global_streak_30',          'seasonal', 'global', '🗓️',   'Режим сезона',           'Делайте прогнозы 30 дней подряд',                     35, 30, 'streak',   'season', 'pick_saved',     0, 'epic',   31),
  ('global_perfect_week',       'seasonal', 'global', '✅🗓️', 'Идеальная неделя',       'Делайте прогнозы каждый день календарной недели',      28, 1,  'boolean',  'season', 'pick_saved',     0, 'epic',   32),
  ('global_double_exact_week',  'seasonal', 'global', '🎯🎯', 'Дубль точности',         'Угадайте 2 точных счёта за неделю',                   24, 2,  'counter',  'season', 'scores_updated', 0, 'epic',   33),
  ('global_exact_5',            'seasonal', 'global', '🧠🎯', 'Мастер точного счёта',   'Угадайте 5 точных счетов за сезон',                   32, 5,  'counter',  'season', 'scores_updated', 0, 'epic',   34),
  ('global_exact_10',           'seasonal', 'global', '♟️',   'Гроссмейстер',           'Угадайте 10 точных счетов за сезон',                  42, 10, 'counter',  'season', 'scores_updated', 0, 'epic',   35),
  ('global_golden_joker',       'seasonal', 'global', '🃏🏅', 'Золотой джокер',         'Угадайте точный счёт в джокер-матче',                 34, 1,  'counter',  'season', 'scores_updated', 0, 'epic',   36),
  ('global_lock_discipline_7',  'seasonal', 'global', '🔒',   'Железная дисциплина',    '7 дней подряд все прогнозы сделаны до начала матчей', 25, 7,  'streak',   'season', 'pick_saved',     0, 'epic',   37);

----------------------------------------------------------------------
-- 6) Seed tasks_catalog — SEASONAL LEAGUE tasks
----------------------------------------------------------------------
INSERT OR IGNORE INTO tasks_catalog (task_key, task_type, scope, emoji, title, description, reward_stars, progress_target, progress_kind, reset_scope, phase, league_only, rarity, sort_order) VALUES
  -- Common
  ('league_member',             'seasonal', 'league', '🤝',       'В составе',              'Вступите в лигу',                                       4, 1, 'counter',  'season', 'pick_saved',     1, 'common', 50),
  ('league_first_round',        'seasonal', 'league', '📝',       'Первый тур',             'Сделайте первый прогноз, состоя в лиге',                 4, 1, 'counter',  'season', 'pick_saved',     1, 'common', 51),
  ('league_no_late_5',          'seasonal', 'league', '⏰',       'Без опозданий',          '5 раз успейте сделать прогноз до начала матча в лиге',    4, 5, 'counter',  'season', 'pick_saved',     1, 'common', 52),
  ('league_first_joker',        'seasonal', 'league', '🃏',       'Лиговый джокер',         'Впервые используйте джокер в лиге',                      4, 1, 'counter',  'season', 'pick_saved',     1, 'common', 53),
  -- Rare
  ('league_top3_day',           'seasonal', 'league', '🥉',       'Топ-3 дня',              'Займите топ-3 в лиге по итогам дня',                    10, 3, 'best',     'season', 'scores_updated', 1, 'rare',   60),
  ('league_top3_week',          'seasonal', 'league', '🥈',       'Топ-3 недели',           'Займите топ-3 в лиге по итогам недели',                 12, 3, 'best',     'season', 'scores_updated', 1, 'rare',   61),
  ('league_win_day',            'seasonal', 'league', '🔥',       'Победа дня',             'Займите 1 место в лиге по итогам дня',                  12, 1, 'best',     'season', 'scores_updated', 1, 'rare',   62),
  ('league_exact',              'seasonal', 'league', '🎯',       'Точный в лиге',          'Угадайте точный счёт, состоя в лиге',                   10, 1, 'counter',  'season', 'scores_updated', 1, 'rare',   63),
  ('league_streak_7',           'seasonal', 'league', '🔁',       'Серия в лиге',           'Делайте прогнозы 7 дней подряд в лиге',                 14, 7, 'streak',   'season', 'pick_saved',     1, 'rare',   64),
  -- Epic
  ('league_champion_week',      'seasonal', 'league', '🏆',       'Чемпион недели',         'Займите 1 место в лиге по итогам недели',               18, 1, 'best',     'season', 'scores_updated', 1, 'epic',   70),
  ('league_champion_month',     'seasonal', 'league', '🥇',       'Чемпион месяца',         'Займите 1 место в лиге по итогам месяца',               24, 1, 'best',     'season', 'scores_updated', 1, 'epic',   71),
  ('league_season_leader',      'seasonal', 'league', '👑',       'Лидер сезона',           'Займите 1 место в лиге по итогам сезона',               32, 1, 'best',     'season', 'scores_updated', 1, 'epic',   72),
  ('league_win_streak_3in14',   'seasonal', 'league', '🔥🔁',    'Серия побед',            'Займите 1 место за день 3 раза за 2 недели',             20, 3, 'counter',  'season', 'scores_updated', 1, 'epic',   73),
  ('league_perfect_day_win',    'seasonal', 'league', '✅✅✅',    'Идеальный день',         'Очки во всех 3 матчах + 1 место в лиге за день',        22, 1, 'boolean',  'season', 'scores_updated', 1, 'epic',   74),
  ('league_golden_joker_win',   'seasonal', 'league', '🃏🏅',    'Золотой джокер лиги',    'Точный счёт на джокере + 1 место в лиге за день',       24, 1, 'boolean',  'season', 'scores_updated', 1, 'epic',   75);

----------------------------------------------------------------------
-- 7) Backfill stars_ledger from confirmed seasonal achievements
----------------------------------------------------------------------
INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT
  ua.user_id,
  2 AS season_id,
  'seasonal_task' AS source,
  ua.achievement_id AS task_key,
  'season' AS instance_key,
  a.stars_reward AS stars,
  COALESCE(ua.earned_at, ua.unlocked_at, CAST(strftime('%s','now') AS INTEGER) * 1000) AS created_at
FROM user_achievements ua
JOIN achievements a ON a.id = ua.achievement_id
WHERE ua.state = 'confirmed'
  AND a.stars_reward > 0;

----------------------------------------------------------------------
-- 8) Backfill stars_ledger from completed daily quests
----------------------------------------------------------------------
INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at)
SELECT
  dqp.user_id,
  2 AS season_id,
  'daily_task' AS source,
  dqp.quest_id AS task_key,
  'matchday:' || dqp.day AS instance_key,
  dqp.stars_awarded AS stars,
  COALESCE(dqp.completed_at, CAST(strftime('%s','now') AS INTEGER) * 1000) AS created_at
FROM daily_quest_progress dqp
WHERE dqp.completed = 1
  AND dqp.stars_awarded > 0;

----------------------------------------------------------------------
-- 9) Backfill user_task_progress from seasonal achievements
----------------------------------------------------------------------
INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted, shown_at)
SELECT
  ua.user_id,
  2 AS season_id,
  ua.achievement_id AS task_key,
  'season' AS instance_key,
  ua.progress,
  COALESCE(ua.earned_at, ua.unlocked_at) AS completed_at,
  CASE WHEN a.stars_reward > 0 THEN 1 ELSE 0 END AS reward_granted,
  ua.shown_at
FROM user_achievements ua
JOIN achievements a ON a.id = ua.achievement_id
WHERE ua.state = 'confirmed';

----------------------------------------------------------------------
-- 10) Backfill user_task_progress from daily quests
----------------------------------------------------------------------
INSERT OR IGNORE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted)
SELECT
  dqp.user_id,
  2 AS season_id,
  dqp.quest_id AS task_key,
  'matchday:' || dqp.day AS instance_key,
  1 AS progress,
  dqp.completed_at,
  CASE WHEN dqp.stars_awarded > 0 THEN 1 ELSE 0 END AS reward_granted
FROM daily_quest_progress dqp
WHERE dqp.completed = 1;
