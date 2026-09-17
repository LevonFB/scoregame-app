-- Economy V1 (Этап A) — награды заданий (economy-v1.md §6/§7/§10/§11).
-- Источник истины наград дневных/недельных заданий — tasks_catalog.reward_stars
-- (побеждает хардкод-фолбэк в index.ts; см. listDailyQuestDefinitions).
-- Хардкод-фолбэки (DAILY_QUESTS / WEEKLY_QUESTS_FALLBACK) приведены синхронно в коде.
--
-- Дневное «Точный выстрел» (dq_exact_score, 2⭐, §6) уже активно через хардкод
-- (live с 2026-03-28) и в каталоге не заводится намеренно.
-- Идемпотентно: UPDATE по task_key.

-- §6 глобальные дневные: «Заполнить все прогнозы дня» 3⭐ → 1⭐.
UPDATE tasks_catalog SET reward_stars = 1 WHERE task_key = 'dq_full_day';

-- §7 дневные лиговые.
UPDATE tasks_catalog SET reward_stars = 1 WHERE task_key = 'dq_league_points';  -- 2 → 1
UPDATE tasks_catalog SET reward_stars = 2 WHERE task_key = 'dq_league_win';     -- 3 → 2

-- §10 глобальные недельные.
UPDATE tasks_catalog SET reward_stars = 3 WHERE task_key = 'weekly_active_days_3';      -- 8 → 3
UPDATE tasks_catalog SET reward_stars = 3 WHERE task_key = 'weekly_points_days_3';      -- 8 → 3
UPDATE tasks_catalog SET reward_stars = 6 WHERE task_key = 'global_double_exact_week';  -- 12 → 6

-- §11 недельные лиговые.
UPDATE tasks_catalog SET reward_stars = 4 WHERE task_key = 'league_top3_week';      -- 14 → 4
UPDATE tasks_catalog SET reward_stars = 6 WHERE task_key = 'league_champion_week';  -- 20 → 6
