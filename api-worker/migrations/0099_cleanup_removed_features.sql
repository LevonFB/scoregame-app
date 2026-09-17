-- Migration 0099: remove stale configuration / history left by the World Cup + level removal.
--
-- Mechanics removed: World Cup bracket (app-section visibility row) and seasonal levels
-- (level-milestone task definitions + their historical per-user progress). Runtime code for
-- both was removed in the Stage 1 + Stage 1.5 rollout, so none of these rows has a reader.
--
-- The Stage 2A production audit measured the exact target rows:
--   * user_task_progress  task_key LIKE 'level_%'  -> 72 rows (all instance_key='season');
--   * tasks_catalog       task_key LIKE 'level_%'  -> 7 rows (level_5 .. level_40 defs);
--   * app_section_visibility section_key='wc2026_bracket' -> 1 row.
--
-- PRESERVED ON PURPOSE: star-related task progress, reward_ledger, season stars, season
-- identity, star-exchange config, and all NON-level achievements/tasks. Admin permissions are
-- NOT touched (audit found 0 `wc_bracket_%` entries in app_settings.extra_admins).
--
-- PRECONDITIONS (operational, NOT enforced by SQL): apply ONLY AFTER the Stage 1 + 1.5 code is
-- deployed to production AND a backup / D1 Time Travel bookmark has been taken.

-- 1) historical level-milestone task progress (level_% keys only — star/quest progress kept)
DELETE FROM user_task_progress WHERE task_key LIKE 'level_%';

-- 2) level-milestone task definitions
DELETE FROM tasks_catalog WHERE task_key LIKE 'level_%';

-- 3) stale World Cup bracket app-section visibility row
DELETE FROM app_section_visibility WHERE section_key = 'wc2026_bracket';
