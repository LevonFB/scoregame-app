-- Migration 0098: drop the legacy seasonal "level" schema.
--
-- Mechanic removed: the seasonal user "level" / gold avatar frame gamification. Stars remain
-- the active seasonal currency and live on user_season_progress.stars (NOT removed).
--
-- Runtime code for this mechanic was already removed in the Stage 1 + Stage 1.5 rollout
-- (level UI, milestones, season_levels reads, /me/level level fields, admin level editor).
-- The Stage 2A production audit confirmed for user_season_progress.level and .gold_avatar_frame:
--   * both columns exist;
--   * neither is part of the PRIMARY KEY;
--   * neither participates in any index, foreign key, CHECK or UNIQUE constraint;
--   * no trigger or view references them;
--   * active runtime reads/writes = 0.
-- => a direct ALTER TABLE ... DROP COLUMN is safe (SQLite >= 3.35 / Cloudflare D1).
--
-- PRESERVED ON PURPOSE: every user_season_progress row, the PK (user_id, season_number) and
-- the stars balance are untouched. Only the two dead columns and the level-config table go.
--
-- PRECONDITIONS (operational, NOT enforced by SQL): apply ONLY AFTER the Stage 1 + 1.5 code is
-- deployed to production AND a backup / D1 Time Travel bookmark has been taken.

DROP TABLE IF EXISTS season_levels;

ALTER TABLE user_season_progress DROP COLUMN level;
ALTER TABLE user_season_progress DROP COLUMN gold_avatar_frame;
