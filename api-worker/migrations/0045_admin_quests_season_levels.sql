-- Migration 0045: Admin quest management + season levels
-- Adds is_enabled/season_id to tasks_catalog for admin control.
-- Creates season_levels table to replace hardcoded LEVEL_COSTS.

----------------------------------------------------------------------
-- 1) Extend tasks_catalog for admin control
----------------------------------------------------------------------
ALTER TABLE tasks_catalog ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks_catalog ADD COLUMN season_id INTEGER DEFAULT NULL;

----------------------------------------------------------------------
-- 2) Season levels table (replaces hardcoded LEVEL_COSTS array)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS season_levels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id     INTEGER NOT NULL,
  level_number  INTEGER NOT NULL,
  stars_required INTEGER NOT NULL DEFAULT 0,
  reward_type   TEXT DEFAULT NULL,
  reward_amount INTEGER DEFAULT NULL,
  reward_payload_json TEXT DEFAULT NULL,
  UNIQUE(season_id, level_number)
);

CREATE INDEX IF NOT EXISTS idx_season_levels_season
  ON season_levels(season_id, level_number);

----------------------------------------------------------------------
-- 3) Seed default levels for existing seasons based on LEVEL_COSTS
-- LEVEL_COSTS = [6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,14,14,15,
--                16,17,17,18,18,19,19,20,21,22,23,35,37,39,41,43,45,47,49,51]
-- Level 1 starts at 0 stars, level N starts at sum of costs[0..N-2]
----------------------------------------------------------------------
-- We insert for every season that currently exists in the seasons table.
-- Each row: level_number 1..40, stars_required = cumulative sum.

-- Level 1 = 0 stars (always)
-- Level 2 = 6 stars
-- Level 3 = 12 stars (6+6)
-- Level 4 = 19 stars (6+6+7)
-- ... etc
-- We use a manual insert with pre-calculated cumulative values.

-- Written as a VALUES list rather than chained UNION ALL SELECTs: D1 caps the number of
-- terms in a compound SELECT very low, and the original single 40-term UNION ALL was
-- rejected outright, so this migration could not run against a fresh D1 at all
-- (rewritten 2026-08-05 — same rows, same values; INSERT OR IGNORE keeps it replay-safe).
-- Note: the VALUES columns must stay as column1/column2 — D1 rejects `AS v(a, b)`.
INSERT OR IGNORE INTO season_levels (season_id, level_number, stars_required)
SELECT s.id, v.column1, v.column2
FROM (VALUES
  (1, 0),    (2, 6),    (3, 12),   (4, 19),   (5, 26),
  (6, 34),   (7, 42),   (8, 51),   (9, 60),   (10, 70),
  (11, 80),  (12, 91),  (13, 102), (14, 114), (15, 126),
  (16, 139), (17, 152), (18, 166), (19, 180), (20, 195),
  (21, 211), (22, 228), (23, 245), (24, 263), (25, 281),
  (26, 300), (27, 319), (28, 339), (29, 360), (30, 382),
  (31, 405), (32, 440), (33, 477), (34, 516), (35, 557),
  (36, 600), (37, 645), (38, 692), (39, 741), (40, 792)
) v
CROSS JOIN seasons s;
