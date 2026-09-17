-- 0131: обнулить reward_balls у недельных заданий (аудит экономики 2026-07-22)
--
-- Проблема: в tasks_catalog у трёх недельных заданий стоял reward_balls
-- (global_double_exact_week=2, league_top3_week=1, league_champion_week=1),
-- но выплаты не происходило: обе точки выдачи недельных наград
-- (index.ts:12802 и :13061) начисляют только reward_stars через
-- awardStarsViaLedger. Все пути awardBalls идут через checkAchievements,
-- отключённый флагом SEASONAL_TASKS_ENABLED=false.
--
-- Значения — наследство от времён, когда эти task_key были сезонными
-- достижениями; в tasks_catalog они попали ручными правками вне миграций
-- (см. примечание в 0026_balls_backfill_shop.sql:25). На свежей БД колонка
-- уже 0 по умолчанию, поэтому здесь UPDATE — no-op.
--
-- Данных не теряем и игрокам ничего не отнимаем: API недельных заданий
-- отдаёт reward_balls: 0 жёстко (index.ts:24360, :24402), в UI мячи за эти
-- задания никогда не показывались, в balls_ledger по ним ничего не начислено.
--
-- Направление правки соответствует economy-v1.md: прямые мячи за задания
-- запрещены — они минуют потолок обмена (20⭐=1⚽, ≤120⭐/нед).

UPDATE tasks_catalog
SET reward_balls = 0
WHERE task_key IN (
  'global_double_exact_week',
  'league_top3_week',
  'league_champion_week'
)
AND reward_balls <> 0;
