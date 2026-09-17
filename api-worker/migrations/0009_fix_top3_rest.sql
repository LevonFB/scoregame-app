-- 0009_fix_top3_rest.sql

-- 1. Create new table with updated CHECK constraint
CREATE TABLE IF NOT EXISTS top3_overrides_new (
  day TEXT PRIMARY KEY,        -- YYYY-MM-DD
  mode TEXT NOT NULL CHECK(mode IN ('AUTO','MANUAL','REST')),
  match_ids_json TEXT,         -- JSON array of 3 match IDs (required if MANUAL)
  updated_at TEXT NOT NULL,
  updated_by INTEGER NOT NULL
);

-- 2. Copy data
INSERT INTO top3_overrides_new (day, mode, match_ids_json, updated_at, updated_by)
SELECT day, mode, match_ids_json, updated_at, updated_by FROM top3_overrides;

-- 3. Drop old table
DROP TABLE top3_overrides;

-- 4. Rename new table
ALTER TABLE top3_overrides_new RENAME TO top3_overrides;
