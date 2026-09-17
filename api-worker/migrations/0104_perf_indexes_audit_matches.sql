-- 0104: Additive performance indexes to stop full-table scans surfaced by D1
-- query insights (rows-read hotspots), 2026-06-29.
--
-- 1) admin_audit(action): the daily-case backfill check
--    `SELECT id FROM admin_audit WHERE action = 'DAILY_CASE...'` was scanning the
--    whole table (~12.66k rows read). An index on action makes it a point lookup.
--
-- 2) matches(is_pick, start_time): season/week detection queries filter matches by
--    is_pick=1 over a start_time range (e.g. current-season resolution), which were
--    full-scanning the matches table (~19k+ rows read across calls). This composite
--    index lets those range scans use the index instead of the whole table.
--
-- Both are CREATE INDEX IF NOT EXISTS (idempotent, non-destructive, no data change).

CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit(action);

CREATE INDEX IF NOT EXISTS idx_matches_pick_start ON matches(is_pick, start_time);
