-- 0014_featured_matches_and_quiet_hours_off.sql
-- Preferred Top-3 storage for bot reminders (without matches.is_pick dependency)

CREATE TABLE IF NOT EXISTS featured_matches (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  pos INTEGER NOT NULL CHECK (pos BETWEEN 1 AND 3),
  source TEXT NOT NULL DEFAULT 'MANUAL',
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  PRIMARY KEY (day, match_id),
  UNIQUE (day, pos),
  FOREIGN KEY (day, match_id) REFERENCES matches(day, match_id)
);

CREATE INDEX IF NOT EXISTS idx_featured_matches_day_pos ON featured_matches(day, pos);
CREATE INDEX IF NOT EXISTS idx_featured_matches_day_match_id ON featured_matches(day, match_id);

-- Backfill from admin manual overrides if present
INSERT OR IGNORE INTO featured_matches (day, match_id, pos, source, updated_at)
SELECT
  t.day,
  CAST(je.value AS TEXT) AS match_id,
  CAST(je.key AS INTEGER) + 1 AS pos,
  'MANUAL' AS source,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS updated_at
FROM top3_overrides t, json_each(t.match_ids_json) je
WHERE t.mode = 'MANUAL'
  AND t.match_ids_json IS NOT NULL
  AND CAST(je.key AS INTEGER) BETWEEN 0 AND 2;

-- Quiet hours are disabled globally (keep columns for future use)
UPDATE reminder_settings
SET quiet_start = 0,
    quiet_end = 0
WHERE quiet_start <> 0 OR quiet_end <> 0;
