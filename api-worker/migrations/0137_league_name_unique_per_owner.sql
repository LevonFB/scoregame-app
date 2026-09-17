-- Migration: 0137_league_name_unique_per_owner.sql
-- One owner may no longer hold two active private leagues with the same name.
--
-- Scope is deliberately per-owner, not global: private leagues are found by
-- invite code, not by name, so a global constraint would burn popular titles
-- ("Друзья", "Работа") for everyone within days of launch while solving
-- nothing. The real confusion is a single owner staring at three identical
-- entries in their own list.
--
-- Matching runs on name_norm rather than name because SQLite's built-in
-- lower() is ASCII-only: lower('Лига') stays 'Лига', so a Cyrillic case
-- variant would slip past an expression index. The column is filled by the
-- Worker via JS toLowerCase(), which handles Cyrillic correctly.
--
-- Data impact: leagues is empty in production (reset 2026-08-06), so the
-- backfill touches nothing and the unique index cannot fail on existing rows.
-- Should this ever run against populated data, the backfill below would
-- surface pre-existing duplicates as an index creation error — resolve them
-- by renaming before re-applying.

ALTER TABLE leagues ADD COLUMN name_norm TEXT;

-- Backfill: ASCII-only lower() is imperfect here, but it is the best SQL can
-- do; the Worker overwrites name_norm properly on the next rename.
UPDATE leagues SET name_norm = lower(trim(name)) WHERE name_norm IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leagues_owner_name_unique
  ON leagues(owner_id, name_norm)
  WHERE deleted_at IS NULL AND type = 'private' AND name_norm IS NOT NULL;
